'use strict';

(function() {
    const CONFIG = {
        gravity: 1200,
        trailDistance: [15, 45],
        refraction: 0.5,
        alphaMultiply: 20.0,
        alphaSubtract: 0.1,
    };

    class RainDrop {
    constructor(x, y, size, ratio, engine) {
        this.engine = engine;
        this.x = x;
        this.y = y;
        this.r = size * ratio;
        this.vy = 0;
        this.vx = 0;
        this.terminated = false;
        
        // --- 表面张力与空气动力学参数 ---
        // 质量越大，受重力影响越直接，受风力偏转越小
        this.mass = this.r * 1.5; 
        this.windSensitivity = (1 / this.r) * 0.5 + 0.3; // 小雨滴更随风飘荡
        
        // 初始物理状态
        this.phase = Math.random() * Math.PI * 2;
        this.oscFreq = 0.01 + (Math.random() * 0.01);
        
        // 轨迹距离受质量影响（表面张力滞后效应）
        this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
        this.lastTrailY = y;
        this.lastTrailX = x;
    }

    update(dt, height, time) {
        const currentGravity = this.engine.customGravity || CONFIG.gravity;

        // 1. 模拟自然波动阵风 (Noise-like Wind)
        let windBase = Math.sin(time * 0.0008) * 250 + 
                       Math.sin(time * 0.002) * 120 + 
                       (Math.random() - 0.5) * 50; // 细微湍流

        const windAccel = windBase * this.windSensitivity;

        // 2. 模拟终端速度 (Terminal Velocity)
        // 物理公式：重力减去空气阻力 (阻力与速度平方成正比)
        // 这里的 0.0005 是空气阻力系数，由表面张力/截面积决定
        const airResistance = 0.0005 * (this.vy * this.vy);
        const netGravity = currentGravity - airResistance;

        this.vy += netGravity * dt;
        this.vx += (windAccel - this.vx * 0.5) * dt; // 风阻衰减

        // 3. 整合重力与表面张力带来的轨迹晃动
        this.y += this.vy * dt;
        // 侧向位移：风力 + 表面张力造成的微小摆动
        this.x += this.vx * dt + Math.sin(this.y * this.oscFreq + this.phase) * (this.r * 0.2);

        // 4. 判断是否生成拖尾
        const distMoved = Math.hypot(this.y - this.lastTrailY, this.x - this.lastTrailX);
        if (distMoved > this.nextTrailDist) {
            this.lastTrailY = this.y;
            this.lastTrailX = this.x;
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
        this.gl = this.canvas.getContext('webgl', { alpha: false, depth: false });
        this.drops = [];
        this.staticDrops = [];
        this.lastTime = 0;
        this.backgroundLoaded = false;
        
        this.spawnChance = 0.08;
        this.sizeRange = [12, 35];
        this.fadeSpeed = 2.5;
        this.customGravity = 1200;

        this.init();
        window.rainEngine = this;
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        const vs = `attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}`;
        const fs = `
            precision mediump float;
            uniform sampler2D u_bg, u_water;
            uniform vec2 u_res, u_bgRes;
            uniform float u_ref, u_aMult, u_aSub;
            varying vec2 v;
            void main() {
                vec2 s = u_res / u_bgRes;
                float scale = max(s.x, s.y);
                vec2 uv = (v - 0.5) * (s / scale) + 0.5;
                vec4 water = texture2D(u_water, v);
                vec2 offset = (water.rg - 0.5) * u_ref * water.b;
                vec4 bg = texture2D(u_bg, uv + offset);
                float alpha = clamp(water.a * u_aMult - u_aSub, 0.0, 1.0);
                gl_FragColor = mix(bg, bg + pow(water.b, 3.0) * 0.3, alpha);
            }
        `;

        const prog = gl.createProgram();
        const shader = (t, s) => { 
            const h = gl.createShader(t); 
            gl.shaderSource(h, s); 
            gl.compileShader(h); 
            gl.attachShader(prog, h); 
        };
        shader(gl.VERTEX_SHADER, vs); 
        shader(gl.FRAGMENT_SHADER, fs);
        gl.linkProgram(prog); 
        gl.useProgram(prog);
        this.prog = prog;

        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
        this.waterCanvas = document.createElement('canvas');
        this.waterCtx = this.waterCanvas.getContext('2d');
        this.dropShape = this.createDropShape();

        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
        const p = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

        this.resize();
        this.updateBackground('pensive.png');
        requestAnimationFrame(t => this.loop(t));
    };

    RainRenderer.prototype.createDropShape = function() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            // 将坐标归一化到 -1 到 1
            let dx = (x - 32) / 32;
            let dy = (y - 32) / 32;
            
            // --- 核心：表面张力形态算法 ---
            // 模拟受重力影响下部略微下坠且扁平的物理形态
            let dist = Math.sqrt(dx * dx * 1.1 + dy * dy * (dy > 0 ? 0.8 : 1.3));
            
            let i = (y * size + x) * 4;
            if (dist <= 1.0) {
                // f 代表透明度和光强：边缘更清晰，中心更厚实
                let f = Math.pow(1.0 - dist, 1.2); 
                
                // RG 通道存储的是法线偏移（用于 WebGL 里的折射计算）
                img.data[i] = (dx * 0.5 + 0.5) * 255;   // R: 水平折射
                img.data[i+1] = (dy * 0.5 + 0.5) * 255; // G: 垂直折射
                // B 通道存储的是高光强度
                img.data[i+2] = f * 255;               
                // A 通道控制水滴透明度
                img.data[i+3] = f * 255;               
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
};
    RainRenderer.prototype.updateBackground = function(url) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, this.texBg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            this.bgImage = img;
            this.backgroundLoaded = true;
        };
        img.onerror = () => {
            const dummy = document.createElement('canvas');
            dummy.width = dummy.height = 2;
            const dctx = dummy.getContext('2d');
            dctx.fillStyle = '#050505'; dctx.fillRect(0,0,2,2);
            this.bgImage = dummy;
            this.backgroundLoaded = true;
        };
        img.src = url;
    };

   RainRenderer.prototype.loop = function(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.033);
    this.lastTime = now;

    // 1. 生成雨滴
    if (Math.random() < this.spawnChance) {
        const r = this.sizeRange;
        const size = Math.random() * (r[1] - r[0]) + r[0];
        this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -100, size, this.ratio, this));
    }

    const ctx = this.waterCtx;
    ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

    // 2. 更新与绘制
    [this.staticDrops, this.drops].forEach((list, idx) => {
        for (let i = list.length - 1; i >= 0; i--) {
            let d = list[i];
            
            if (idx === 0) {
                // 玻璃上的残迹缩小
                d.r -= dt * this.fadeSpeed;
            } else {
                // 下落雨滴更新物理位置
                if (d.update(dt, this.waterCanvas.height, now)) {
                    // 产生拖尾残迹
                    this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.45, terminated: false });
                }
            }
            
            // 边界检查
            if (d.terminated || d.r < 0.5) { 
                list.splice(i, 1); 
                continue; 
            }

            // --- 核心绘制部分 ---
            ctx.save();
            ctx.translate(d.x, d.y);

            if (idx === 1) { 
                // 计算移动方向的角度 (修正为正确的 atan2 顺序)
                const angle = Math.atan2(d.vy, d.vx); 
                ctx.rotate(angle - Math.PI / 2); // 减去 90 度使雨滴头朝下

                // 计算拉伸：速度越快越长
                const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
                const stretch = Math.min(speed * 0.05, d.r * 2); 
                
                // 纵向拉伸绘制
                ctx.drawImage(this.dropShape, -d.r, -d.r, d.r * 2, (d.r + stretch) * 2);
            } else {
                // 静态残迹
                ctx.globalAlpha = 0.6;
                ctx.drawImage(this.dropShape, -d.r, -d.r, d.r * 2, d.r * 2);
            }
            ctx.restore();
        }
    });

    // 3. WebGL 混合与渲染 (保持原样)
    if (!this.backgroundLoaded) return requestAnimationFrame(t => this.loop(t));
    
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texWater);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);
    
    // 必须要设置纹理参数，否则某些浏览器下会黑屏
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texBg);

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
        new RainRenderer(document.getElementById('container'));
    });
    window.addEventListener('resize', () => {
        if(window.rainEngine) window.rainEngine.resize();
    });
})();
