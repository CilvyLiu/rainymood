'use strict';

(function() {
    const CONFIG = {
        gravity: 1200,          // 默认重力
        trailDistance: [15, 45], 
        refraction: 0.5,         
        alphaMultiply: 20.0,    
        alphaSubtract: 0.1,     
        spawnInterval: 0.08,    
    };

    class RainDrop {
        constructor(x, y, size, ratio, engine) {
            this.engine = engine; // 引用引擎以获取动态参数
            this.x = x;
            this.y = y;
            this.r = size * ratio; 
            this.velocity = 0; 
            this.terminated = false;
            this.lastTrailY = y;
            this.shifting = (Math.random() - 0.5) * (size * 0.15); 
            this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
        }

        update(dt, height) {
            // 联动 HTML 传回的 customGravity，实现不同天气的速度感
            const currentGravity = this.engine.customGravity || CONFIG.gravity;
            const friction = 0.005 * this.r;
            const accel = currentGravity - (this.velocity * friction);
            
            this.velocity += accel * dt;
            this.y += this.velocity * dt;
            
            // 左右微摆
            this.x += Math.sin(this.y * 0.06) * (this.shifting * dt);

            if (this.y - this.lastTrailY > this.nextTrailDist) {
                this.lastTrailY = this.y;
                return true; 
            }
            if (this.y > height + 100) this.terminated = true;
            return false;
        }
    }

    function RainRenderer(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        container.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl', { alpha: false });
        this.drops = [];
        this.staticDrops = [];
        this.lastTime = 0;
        this.backgroundLoaded = false;
        this.bgImage = null;
        
        // 动态控制参数（由 HTML 注入）
        this.spawnChance = 0.08;
        this.sizeRange = [12, 35];
        this.fadeSpeed = 2.5;
        this.customGravity = 1200;

        this.init();
        window.rainEngine = this; // 暴露给 index.html 使用
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        const vs = `attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}`;
        const fs = `
            precision mediump float;
            uniform sampler2D u_bg, u_water;
            uniform vec2 u_res, u_bgRes;
            varying vec2 v;
            uniform float u_ref, u_aMult, u_aSub;
        
            void main() {
                vec2 s = u_res / u_bgRes;
                float scale = max(s.x, s.y);
                vec2 uv = (v - 0.5) * (s / scale) + 0.5;
                vec4 water = texture2D(u_water, v);
                vec2 refractionOffset = (water.rg - 0.5) * u_ref * water.b;
                float alpha = clamp(water.a * u_aMult - u_aSub, 0.0, 1.0);
                vec4 bg = texture2D(u_bg, uv + refractionOffset);
                float highlight = pow(water.b, 3.0) * 0.3;
                gl_FragColor = mix(bg, bg + highlight, alpha);
            }
        `;

        const prog = gl.createProgram();
        const addShader = (t, s) => { 
            const h = gl.createShader(t); 
            gl.shaderSource(h, s); gl.compileShader(h); 
            gl.attachShader(prog, h); 
        };
        addShader(gl.VERTEX_SHADER, vs); addShader(gl.FRAGMENT_SHADER, fs);
        gl.linkProgram(prog); gl.useProgram(prog);
        this.prog = prog;

        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
        
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.waterCanvas = document.createElement('canvas');
        this.waterCtx = this.waterCanvas.getContext('2d');
        this.dropShape = this.createDropShape();

        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
        const p = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

        this.resize();
        requestAnimationFrame(t => this.loop(t));
    };

    RainRenderer.prototype.createDropShape = function() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    
    // 随机因子：让每个像素的判断都带有一点点不规则抖动
    const noise = () => (Math.random() - 0.5) * 0.15;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let dx = (x - 32) / 32;
            let dy = (y - 32) / 32;

            // 物理学：模拟附着力。水滴顶部受牵引变窄，底部受重力堆积
            // 引入扰动，让左右不对称，打破规律感
            let stretch = dy > 0 ? 0.85 + noise() : 1.15 + noise();
            
            // 加入一个横向的挤压随机值
            let skew = dx + (dy * 0.1); 
            
            let dist = Math.sqrt(skew * skew * 1.2 + dy * dy * stretch);

            let i = (y * size + x) * 4;
            // 边缘不再是硬着陆，而是带有扩散感的张力层
            if (dist <= 1.0) {
                let f = Math.pow(1.0 - dist, 1.5); // 稍微硬一点的边缘，更像水滴
                
                // 关键：模拟水滴内部的非均匀折射
                img.data[i] = (dx * 0.45 + 0.55) * 255;   
                img.data[i+1] = (dy * 0.35 + 0.65) * 255; 
                img.data[i+2] = f * 255;               
                img.data[i+3] = f * 220; // 稍微降低一点透明度，增加厚重感
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
};
    RainRenderer.prototype.resize = function() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.ratio = window.devicePixelRatio || 1;
        this.canvas.width = this.waterCanvas.width = this.width * this.ratio;
        this.canvas.height = this.waterCanvas.height = this.height * this.ratio;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    };

    RainRenderer.prototype.updateBackground = function(url) {
        const gl = this.gl;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, this.texBg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.bgImage = img;
            this.backgroundLoaded = true;
        };
        img.src = url;
    };

   RainRenderer.prototype.loop = function(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.033);
    this.lastTime = now;

    // 1. 生成雨滴逻辑
    if (Math.random() < this.spawnChance) {
        const range = this.sizeRange || [12, 55];
        const randomSize = Math.random() * (range[1] - range[0]) + range[0];
        const xPos = Math.random() * this.waterCanvas.width;
        this.drops.push(new RainDrop(xPos, -100, randomSize, this.ratio, this));
    }

    const ctx = this.waterCtx;
    ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

    // 2. 残留水珠擦除逻辑 (物理增强：非等比缩放 + 不规则倾斜)
    for (let i = this.staticDrops.length - 1; i >= 0; i--) {
        let s = this.staticDrops[i];
        s.r -= dt * (this.fadeSpeed || 2.5); 
        if (s.r < 0.5) { this.staticDrops.splice(i, 1); continue; }

        ctx.save();
        ctx.translate(s.x, s.y);
        // 【物理修正】：残留水珠不是圆的，而是扁平或拉长的水渍
        // 使用 s.phase (如果没定义就初始化) 来保持每一滴水珠独特的变形比
        if(!s.scaleX) {
            s.scaleX = 0.8 + Math.random() * 0.6;
            s.scaleY = 0.7 + Math.random() * 0.4;
            s.angle = (Math.random() - 0.5) * 0.8; 
        }
        ctx.rotate(s.angle);
        // 这里的 s.r * 2 * s.scaleX 让它彻底告别“圆滚滚”
        ctx.drawImage(this.dropShape, -s.r * s.scaleX, -s.r * s.scaleY, s.r * 2 * s.scaleX, s.r * 2 * s.scaleY);
        ctx.restore();
    }

    // 3. 主雨滴滑落逻辑 (物理增强：水量损耗 + 轨迹抖动)
    for (let i = this.drops.length - 1; i >= 0; i--) {
        let d = this.drops[i];
        
        if (d.update(dt, this.waterCanvas.height)) {
            // 【水量损耗】：滑行留下痕迹，自身半径缩小
            d.r *= 0.97; 

            // 【物理修正】：并不是每次更新都留下完美的圆，有时是细碎水花
            if (Math.random() > 0.2) {
                this.staticDrops.push({ 
                    x: d.x + (Math.random() - 0.5) * 4, // 轨迹随机偏移
                    y: d.y, 
                    r: d.r * (Math.random() * 0.3 + 0.2) // 残留大小极度随机
                });
            }
        }
        
        if (d.terminated || d.r < 2.0) { this.drops.splice(i, 1); continue; }
        
        // 【物理修正】：主雨滴滑落时的拉伸感
        const stretch = 1.3 + (d.velocity / 1800);
        const w = d.r * 2 * (0.9 + Math.random() * 0.2); // 宽度微颤
        const h = d.r * 2 * stretch;

        ctx.save();
        ctx.translate(d.x, d.y);
        // 增加随速度变化的摆动
        ctx.rotate(Math.sin(d.y * 0.05) * 0.08); 
        ctx.drawImage(this.dropShape, -w / 2, -h / 2, w, h);
        ctx.restore();
    }

    // 4. WebGL 渲染层 (保持不变)
    if (!this.backgroundLoaded) return requestAnimationFrame(t => this.loop(t));
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBg);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texWater);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);

    const loc = (n) => gl.getUniformLocation(this.prog, n);
    gl.uniform1i(loc("u_bg"), 0);    
    gl.uniform1i(loc("u_water"), 1); 
    gl.uniform2f(loc("u_res"), this.canvas.width, this.canvas.height);
    gl.uniform2f(loc("u_bgRes"), this.bgImage.width, this.bgImage.height);
    gl.uniform1f(loc("u_ref"), CONFIG.refraction);
    gl.uniform1f(loc("u_aMult"), CONFIG.alphaMultiply);
    gl.uniform1f(loc("u_aSub"), CONFIG.alphaSubtract);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(t => this.loop(t));
};
    window.addEventListener('load', () => {
        const container = document.getElementById('container');
        if(!container) return;
        const renderer = new RainRenderer(container);
        renderer.updateBackground('pensive.png'); 
        window.addEventListener('resize', () => renderer.resize());
    });
})();
