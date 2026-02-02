'use strict';

(function() {
    /**
     * Nova, 我们在这里微调了物理常数：
     * 1. 增加 gravity 模拟真实重力感。
     * 2. 调整 alphaMultiply 确保水滴边缘既锐利又有折射感。
     */
    const CONFIG = {
        gravity: 2800,           // 略微调高重力，增加下落冲击力
        trailDistance: [10, 40], // 拖尾生成的随机间距范围
        refraction: 0.65,        // 折射强度
        alphaMultiply: 55.0,     // 增强对比度，解决水滴边缘模糊问题
        alphaSubtract: 0.12      // 剔除微小噪点
    };

    class RainDrop {
        constructor(x, y, size, ratio, baseSpeed) {
            // 【随机位置优化】：引入正态分布偏差，防止雨滴在同一竖线排队
            this.x = x + (Math.random() - 0.5) * 200; 
            // 初始高度随机偏移，避免“一排排掉落”
            this.y = y - Math.random() * 800; 
            
            // 【随机大小分布】：模拟自然界雨滴大小不一的权重
            const weightSeed = Math.random();
            // 15% 概率产生大水滴，45% 概率产生细碎小雨，其余为中等
            const sizeScale = weightSeed > 0.85 ? 1.5 : (weightSeed < 0.45 ? 0.5 : 1.0);
            this.r = size * ratio * sizeScale;
            
            // 【物理差异化】：重力加速度与大小挂钩，模拟空气阻力对不同体积的影响
            this.mass = sizeScale;
            this.velocity = (150 + Math.random() * 400) * sizeScale; 
            
            this.terminated = false;
            this.lastTrailY = this.y;
            // 随机化下一次产生拖尾的物理距离
            this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
        }

        update(dt, height, baseSpeed) {
            // 物理公式：v = v0 + a*t
            const accel = CONFIG.gravity * (baseSpeed / 4) * (this.mass * 0.8 + 0.2); 
            this.velocity += accel * dt;
            this.y += (this.velocity + baseSpeed * 65) * dt;

            // 【形状抖动】：模拟雨滴在玻璃滑动时的微小左右偏移（非线性运动）
            this.x += Math.sin(this.y * 0.03 + this.mass) * 0.4;

            if (this.y - this.lastTrailY > this.nextTrailDist) {
                this.lastTrailY = this.y;
                return true; // 触发拖尾
            }
            if (this.y > height + 200) this.terminated = true;
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

        this.options = {
            rainChance: 0.6,
            baseSpeed: 4 
        };
        
        this.init();
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        const vs = `attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}`;
        const fs = `
            precision mediump float;
            uniform sampler2D u_bg, u_water;
            varying vec2 v;
            uniform float u_ref, u_aMult, u_aSub;
            void main() {
                vec4 water = texture2D(u_water, v);
                vec2 offset = (water.rg - 0.5) * u_ref;
                float alpha = clamp(water.a * u_aMult - u_aSub, 0.0, 1.0);
                vec4 bg = texture2D(u_bg, v + offset);
                // 增加一点高光反射，提升质感
                gl_FragColor = mix(bg, bg + water.b * 0.4, alpha);
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
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let dx = (x - 32)/32, dy = (y - 32)/32;
                let dist = Math.sqrt(dx*dx + dy*dy);
                let i = (y * size + x) * 4;
                if (dist <= 1.0) {
                    let f = Math.pow(1.0 - dist, 2);
                    img.data[i] = (dx * 0.5 + 0.5) * 255;   // Normal R
                    img.data[i+1] = (dy * 0.5 + 0.5) * 255; // Normal G
                    img.data[i+2] = f * 255;               // Specular
                    img.data[i+3] = f * 255;               // Mask
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
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
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
            this.backgroundLoaded = true;
        };
        img.src = url;
    };

    RainRenderer.prototype.loop = function(now) {
        const dt = Math.min((now - this.lastTime) / 1000, 0.033);
        this.lastTime = now;

        // 【动态补货】：基于概率的非均匀生成
        if (Math.random() < this.options.rainChance * 0.3) {
            this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -100, 22, this.ratio, this.options.baseSpeed));
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        // 1. 静态拖尾处理
        for (let i = this.staticDrops.length - 1; i >= 0; i--) {
            let s = this.staticDrops[i];
            s.r -= dt * 3.2; // 水迹蒸发速度
            if (s.r < 1) { this.staticDrops.splice(i, 1); continue; }
            ctx.drawImage(this.dropShape, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
        }

        // 2. 动态雨滴绘制与物理形变
        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            if (d.update(dt, this.waterCanvas.height, this.options.baseSpeed)) {
                // 留下一个小水滴作为拖尾残余
                this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.4 });
            }
            if (d.terminated) { this.drops.splice(i, 1); continue; }
            
            // 【核心：物理形变逻辑】
            // 速度越快，水滴越细长。通过计算 stretch 因子来改变绘制的长宽比。
            const stretch = Math.min(d.velocity / 1200, 1.8); 
            const drawW = d.r * (1.2 - stretch * 0.15); // 变窄
            const drawH = d.r * (2.8 + stretch * 1.2);  // 变长
            
            ctx.globalAlpha = 0.9;
            ctx.drawImage(this.dropShape, d.x - drawW/2, d.y - drawH/2, drawW, drawH);
            ctx.globalAlpha = 1.0;
        }

        const gl = this.gl;
        gl.useProgram(this.prog);

        // 纹理单元管理
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        const loc = (n) => gl.getUniformLocation(this.prog, n);
        gl.uniform1i(loc("u_bg"), 0);    
        gl.uniform1i(loc("u_water"), 1); 
        gl.uniform1f(loc("u_ref"), CONFIG.refraction);
        gl.uniform1f(loc("u_aMult"), CONFIG.alphaMultiply);
        gl.uniform1f(loc("u_aSub"), CONFIG.alphaSubtract);

        if (this.backgroundLoaded) {
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        
        requestAnimationFrame(t => this.loop(t));
    };

    window.addEventListener('load', () => {
        const container = document.getElementById('container');
        if(!container) return;
        const renderer = new RainRenderer(container);
        window.rainEngine = renderer;
        renderer.updateBackground('pensive.png'); 
        window.addEventListener('resize', () => renderer.resize());
    });
})();
