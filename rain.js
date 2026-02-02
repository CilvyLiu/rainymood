'use strict';

(function() {
    const CONFIG = {
        gravity: 1200,          
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
            
            this.vy = 0; 
            this.vx = 0; 
            
            this.terminated = false;
            this.lastTrailY = y;
            this.lastTrailX = x; 

            this.windSensitivity = Math.random() * 0.5 + 0.8; 
            this.shifting = (Math.random() - 0.5) * (size * 0.4); 
            this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
            
            // 解决痛点 4：每个雨滴自带一个独一无二的形变相位
            this.phase = Math.random() * Math.PI * 2;
        }

        update(dt, height) {
            const currentGravity = this.engine.customGravity || CONFIG.gravity;
            const baseWind = this.engine.spawnChance > 0.5 ? 600 : 200; 
            const windAccel = baseWind * this.windSensitivity;
            
            const friction = 0.003 * this.r;
            const ay = currentGravity - (this.vy * friction);
            
            this.vy += ay * dt;
            this.vx += windAccel * dt - (this.vx * friction); 

            this.y += this.vy * dt;
            this.x += this.vx * dt;
            
            // 解决痛点 3：模拟在玻璃上滑行时的非线性颤动
            this.x += Math.sin(this.y * 0.04 + this.phase) * (this.shifting * dt);

            const distMoved = Math.sqrt(Math.pow(this.y - this.lastTrailY, 2) + Math.pow(this.x - this.lastTrailX, 2));

            if (distMoved > this.nextTrailDist) {
                this.lastTrailY = this.y;
                this.lastTrailX = this.x;
                return true; 
            }

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
        
        // 核心联动：初始参数，会被 index.html 的 changeWeather 实时修改
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
                gl_FragColor = mix(bg, bg + pow(water.b, 3.0) * 0.3, alpha);
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
        const noise = () => (Math.random() - 0.5) * 0.15;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let dx = (x - 32) / 32;
                let dy = (y - 32) / 32;
                let stretch = dy > 0 ? 0.85 + noise() : 1.15 + noise();
                let skew = dx + (dy * 0.1); 
                let dist = Math.sqrt(skew * skew * 1.2 + dy * dy * stretch);
                let i = (y * size + x) * 4;
                if (dist <= 1.0) {
                    let f = Math.pow(1.0 - dist, 1.5); 
                    img.data[i] = (dx * 0.45 + 0.55) * 255;   
                    img.data[i+1] = (dy * 0.35 + 0.65) * 255; 
                    img.data[i+2] = f * 255;               
                    img.data[i+3] = f * 220; 
                }
            }
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    };

    RainRenderer.prototype.resize = function() {
        this.ratio = window.devicePixelRatio || 1;
        this.canvas.width = this.waterCanvas.width = window.innerWidth * this.ratio;
        this.canvas.height = this.waterCanvas.height = window.innerHeight * this.ratio;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    };

    RainRenderer.prototype.updateBackground = function(url) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const gl = this.gl;
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

        // 1. 生成雨滴 (联动 index.html)
        if (Math.random() < this.spawnChance) {
            const range = this.sizeRange;
            const randomSize = Math.random() * (range[1] - range[0]) + range[0];
            const xPos = Math.random() * (this.waterCanvas.width + 600 * this.ratio) - 300 * this.ratio;
            this.drops.push(new RainDrop(xPos, -100, randomSize, this.ratio, this));
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        // --- 核心修改：追尾合并逻辑 (痛点 1) ---
        this.drops.sort((a, b) => a.y - b.y); 
        for (let i = 0; i < this.drops.length; i++) {
            let d1 = this.drops[i];
            if (d1.terminated) continue;
            for (let j = i + 1; j < this.drops.length; j++) {
                let d2 = this.drops[j];
                if (d2.terminated) continue;
                const dx = d1.x - d2.x, dy = d1.y - d2.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < (d1.r + d2.r) * 0.7) {
                    const bigger = d1.r > d2.r ? d1 : d2;
                    const smaller = d1.r > d2.r ? d2 : d1;
                    bigger.r += smaller.r * 0.2; // 合并水量
                    bigger.vy += 40; // 产生重力冲击
                    smaller.terminated = true;
                }
            }
        }

        // 2. 残留水迹逻辑
        for (let i = this.staticDrops.length - 1; i >= 0; i--) {
            let s = this.staticDrops[i];
            s.r -= dt * (this.fadeSpeed || 2.5); 
            if (s.r < 0.5) { this.staticDrops.splice(i, 1); continue; }

            ctx.save();
            ctx.translate(s.x, s.y);
            if(!s.isSetup) {
                s.angle = s.initialAngle || 0;
                s.skew = Math.tan(s.angle) * 0.5; 
                s.scaleY = 1.2 + Math.random() * 2.0; 
                s.isSetup = true;
            }
            ctx.transform(1, 0, s.skew, 1, 0, 0); 
            ctx.rotate(s.angle);
            ctx.globalAlpha = Math.min(1.0, s.r / 2.0);
            ctx.drawImage(this.dropShape, -s.r, -s.r * s.scaleY, s.r * 2, s.r * 2 * s.scaleY);
            ctx.restore();
        }

        // 3. 主雨滴滑落逻辑
        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            if (d.update(dt, this.waterCanvas.height)) {
                d.r *= 0.97; 
                const dropAngle = Math.atan2(d.vx, d.vy); 
                this.staticDrops.push({ 
                    x: d.x, y: d.y, r: d.r * (Math.random() * 0.2 + 0.1),
                    initialAngle: dropAngle 
                });
            }
            if (d.terminated || d.r < 1.5) { this.drops.splice(i, 1); continue; }
            
            const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
            const angle = Math.atan2(d.vx, d.vy); 
            const stretch = 1.4 + (speed / 1500);

            ctx.save();
            ctx.translate(d.x, d.y);
            const skew = Math.sin(angle) * 0.3;
            ctx.transform(1, 0, skew, 1, 0, 0);
            ctx.rotate(-angle); 
            // 解决痛点 4：实时动态拉伸
            const w = d.r * 2 * (0.9 + Math.random() * 0.1);
            const h = d.r * 2 * stretch;
            ctx.drawImage(this.dropShape, -w / 2, -h / 2, w, h);
            ctx.restore();
        }

        // 4. WebGL Final Rendering
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
