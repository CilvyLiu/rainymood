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
        this.engine = engine;
        this.x = x;
        this.y = y;
        this.r = size * ratio; 
        
        // 核心改动：引入双轴速度，实现“飘逸”
        this.vy = 0; // 纵向速度
        this.vx = 0; // 横向风力感
        
        this.terminated = false;
        this.lastTrailY = y;
        this.lastTrailX = x; // 记录轨迹的横坐标

        // 随机特性：每一滴雨对风的敏感度不同
        this.windSensitivity = Math.random() * 0.5 + 0.8; 
        this.shifting = (Math.random() - 0.5) * (size * 0.4); 
        this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
    }

    update(dt, height) {
        const currentGravity = this.engine.customGravity || CONFIG.gravity;
        
        // --- 1. 风力逻辑 (Wind Vector) ---
        // 假设风向向右。暴雨天气风更大。
        const baseWind = this.engine.spawnChance > 0.5 ? 600 : 200; 
        const windAccel = baseWind * this.windSensitivity;
        
        // 模拟空气阻力和重力平衡
        const friction = 0.003 * this.r;
        const ay = currentGravity - (this.vy * friction);
        
        this.vy += ay * dt;
        this.vx += windAccel * dt - (this.vx * friction); // 风力加速度

        // --- 2. 飘逸位移 (Drift) ---
        this.y += this.vy * dt;
        this.x += this.vx * dt;
        
        // 增加更不规则的左右晃动，模拟水珠在玻璃上因附着力不均产生的“扭动”
        this.x += Math.sin(this.y * 0.04) * (this.shifting * dt);

        // --- 3. 拖尾判定 (Trail) ---
        // 计算勾股定理位移，而不是简单的 Y 轴位移
        const distMoved = Math.sqrt(Math.pow(this.y - this.lastTrailY, 2) + Math.pow(this.x - this.lastTrailX, 2));

        if (distMoved > this.nextTrailDist) {
            this.lastTrailY = this.y;
            this.lastTrailX = this.x;
            return true; 
        }

        // 边缘销毁：如果飘出屏幕也算终止
        if (this.y > height + 100 || this.x > window.innerWidth * window.devicePixelRatio + 100) {
            this.terminated = true;
        }
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

    // 1. 生成雨滴逻辑 (考虑到风，让雨滴有概率从屏幕左侧飘入)
    if (Math.random() < this.spawnChance) {
        const range = this.sizeRange || [12, 55];
        const randomSize = Math.random() * (range[1] - range[0]) + range[0];
        // 增加生成范围，防止右侧风大时出现空白区
        const xPos = Math.random() * (this.waterCanvas.width + 400 * this.ratio) - 200 * this.ratio;
        this.drops.push(new RainDrop(xPos, -100, randomSize, this.ratio, this));
    }

    const ctx = this.waterCtx;
    ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

    // 2. 残留水迹逻辑 (让“尾巴”顺着风向撕裂)
    for (let i = this.staticDrops.length - 1; i >= 0; i--) {
        let s = this.staticDrops[i];
        s.r -= dt * (this.fadeSpeed || 2.5); 
        if (s.r < 0.5) { this.staticDrops.splice(i, 1); continue; }

        ctx.save();
        ctx.translate(s.x, s.y);
        
        // 如果没有初始化角度和拉伸，赋予它物理特性
        if(!s.angle) {
            // 这里的 angle 应该继承自产生它的主雨滴
            s.angle = s.initialAngle || 0.4; 
            s.scaleX = 0.6 + Math.random() * 0.4;
            s.scaleY = 1.5 + Math.random() * 2.0; // 重点：让残留物纵向撕裂，不再圆滚滚
        }
        
        ctx.rotate(s.angle);
        ctx.globalAlpha = Math.min(1.0, s.r / 3.0); // 边缘更柔和
        ctx.drawImage(this.dropShape, -s.r * s.scaleX, -s.r * s.scaleY, s.r * 2 * s.scaleX, s.r * 2 * s.scaleY);
        ctx.restore();
    }

    // 3. 主雨滴滑落逻辑 (飘逸风效果 + 轨迹撕裂)
    for (let i = this.drops.length - 1; i >= 0; i--) {
        let d = this.drops[i];
        
        // d.update 内部现在应该已经有了 vx, vy 的逻辑
        if (d.update(dt, this.waterCanvas.height)) {
            d.r *= 0.96; // 产生拖尾会导致主滴水量损耗

            // 【撕裂拖尾】：根据当前 vx 和 vy 计算滑行角度
            const dropAngle = Math.atan2(d.vy, d.vx) - Math.PI/2;
            
            this.staticDrops.push({ 
                x: d.x + (Math.random() - 0.5) * 4, 
                y: d.y, 
                r: d.r * (Math.random() * 0.3 + 0.2),
                initialAngle: dropAngle // 记录产生瞬间的角度，让尾巴斜着躺下
            });
        }
        
        if (d.terminated || d.r < 1.5) { this.drops.splice(i, 1); continue; }
        
        // 【飘逸视觉】：计算实时的倾斜角度和拉伸倍率
        const velocityTotal = Math.sqrt(d.vx * d.vx + d.vy * d.vy) || d.velocity;
        const moveAngle = Math.atan2(d.vy, d.vx) - Math.PI/2;
        const stretch = 1.5 + (velocityTotal / 1500);

        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(moveAngle); // 顺着风向倾斜
        
        const w = d.r * 2 * (0.8 + Math.random() * 0.4); // 模拟空气阻力导致的形态抖动
        const h = d.r * 2 * stretch;
        
        ctx.drawImage(this.dropShape, -w / 2, -h / 2, w, h);
        ctx.restore();
    }

    // 4. WebGL 渲染层
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
