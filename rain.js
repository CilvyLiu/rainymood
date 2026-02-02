'use strict';

(function() {
    const CONFIG = {
        gravity: 1200,
        trailDistance: [10, 35],
        refraction: 0.4,       // 稍微调低增加通透感
        alphaMultiply: 18.0,
        alphaSubtract: 0.2,
        fogIntensity: 0.45,    // 水汽浓度
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
            
            this.windSensitivity = (1 / this.r) * 0.4 + 0.2; 
            this.nextTrailDist = (Math.random() * 20 + 10) * ratio;
            this.lastTrailY = y;
            this.lastTrailX = x;
        }

        update(dt, height, time) {
            const currentGravity = this.engine.customGravity || CONFIG.gravity;
            // 阵风物理量：低频长波波动
            const gust = Math.sin(time * 0.0004) * 350 + Math.sin(time * 0.0011) * 100;
            const windForce = gust * this.windSensitivity;

            // 阻力方程：F = mg - kv^2
            const terminalVelocity = 900 + this.r * 15;
            const netAccel = currentGravity * (1 - Math.pow(this.vy / terminalVelocity, 2));

            this.vy += netAccel * dt;
            this.vx += (windForce - this.vx * 0.8) * dt; 

            this.y += this.vy * dt;
            this.x += this.vx * dt;

            // 留痕判定：模拟表面张力的断裂
            const distMoved = Math.hypot(this.y - this.lastTrailY, this.x - this.lastTrailX);
            if (distMoved > this.nextTrailDist) {
                this.lastTrailY = this.y;
                this.lastTrailX = this.x;
                this.nextTrailDist = (Math.random() * 25 + 5) * this.engine.ratio;
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
        
        this.spawnChance = 0.15; // 提高密度以产生更多洗刷路径
        this.sizeRange = [10, 30];
        this.fadeSpeed = 1.0;    // 洗刷后的痕迹消失（重新结雾）的速度
        this.ratio = window.devicePixelRatio || 1;
    }

    RainRenderer.prototype.resize = function() {
        this.ratio = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.canvas.width = w * this.ratio;
        this.canvas.height = h * this.ratio;
        if (!this.waterCanvas) {
            this.waterCanvas = document.createElement('canvas');
            this.waterCtx = this.waterCanvas.getContext('2d');
        }
        this.waterCanvas.width = this.canvas.width;
        this.waterCanvas.height = this.canvas.height;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    };

    RainRenderer.prototype.createDropShape = function() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                let dx = (x - 32) / 32;
                let dy = (y - 32) / 32;
                // 力学形态：重力形变馒头状
                let dist = Math.sqrt(dx * dx + dy * dy * (dy > 0 ? 0.8 : 1.25)); 
                let i = (y * size + x) * 4;
                if (dist <= 0.8) {
                    let f = Math.pow(1.0 - dist / 0.8, 1.5);
                    img.data[i] = (dx * 0.7 + 0.5) * 255;   
                    img.data[i+1] = (dy * 0.7 + 0.5) * 255; 
                    img.data[i+2] = f * 255;               
                    img.data[i+3] = f * 255;               
                }
            }
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    };

    RainRenderer.prototype.init = function() {
        this.resize();
        this.dropShape = this.createDropShape();
        const gl = this.gl;
        
        const vs = `attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}`;
        const fs = `
            precision mediump float;
            uniform sampler2D u_bg, u_water;
            uniform vec2 u_res, u_bgRes;
            uniform float u_ref, u_aMult, u_aSub, u_fog;
            varying vec2 v;
            void main() {
                vec2 s = u_res / u_bgRes;
                float scale = max(s.x, s.y);
                vec2 uv = (v - 0.5) * (s / scale) + 0.5;
                
                vec4 water = texture2D(u_water, v);
                vec2 offset = (water.rg - 0.5) * u_ref * water.b;
                
                // 物理仿真：基础背景 + 水汽色散
                vec4 bg = texture2D(u_bg, uv + offset);
                vec3 fogColor = vec3(0.85, 0.9, 0.95); 
                
                // 水汽算法：water.a 控制透明路径（洗刷效果）
                // 这里的 u_fog 是基础雾量，water.a 会将其抠开
                float fog = u_fog * (1.0 - clamp(water.a * u_aMult, 0.0, 1.0));
                vec3 finalColor = mix(bg.rgb, fogColor, fog);
                
                // 叠加高光：pow 增加亮点的锐利感
                gl_FragColor = vec4(finalColor + pow(water.b, 2.8) * 0.4, 1.0);
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
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
        const p = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

        this.updateBackground('pensive.png');
        requestAnimationFrame(t => this.loop(t));
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
            this.bgImage = img;
            this.backgroundLoaded = true;
        };
        img.src = url;
    };

    RainRenderer.prototype.loop = function(now) {
        const dt = Math.min((now - this.lastTime) / 1000, 0.033);
        this.lastTime = now;

        if (Math.random() < this.spawnChance) {
            const size = Math.random() * (this.sizeRange[1] - this.sizeRange[0]) + this.sizeRange[0];
            this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -100, size, this.ratio, this));
        }

        const ctx = this.waterCtx;
        
        // --- 洗刷逻辑核心 ---
        // 我们不使用 clearRect，而是用带透明度的 fillRect
        // 这样滑过的痕迹（Alpha > 0）会随时间慢慢被覆盖（重新结雾）
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(255, 255, 255, ${this.fadeSpeed * dt})`; 
        ctx.fillRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);
        ctx.globalCompositeOperation = 'source-over';

        [this.staticDrops, this.drops].forEach((list, idx) => {
            for (let i = list.length - 1; i >= 0; i--) {
                let d = list[i];
                if (idx === 0) d.r -= dt * 2.0; // 静态留痕干涸更快
                else if (d.update(dt, this.waterCanvas.height, now)) {
                    this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.45, terminated: false });
                }
                
                if (d.terminated || d.r < 0.5) { list.splice(i, 1); continue; }

                ctx.save();
                ctx.translate(d.x, d.y);
                if (idx === 1) {
                    const angle = Math.atan2(d.vy, d.vx);
                    ctx.rotate(angle - Math.PI / 2);
                    const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
                    const stretch = Math.min(speed * 0.02, d.r * 0.4); // 极度克制的拉伸
                    ctx.drawImage(this.dropShape, -d.r, -d.r, d.r * 2, (d.r + stretch) * 2);
                } else {
                    ctx.globalAlpha = 0.5;
                    ctx.drawImage(this.dropShape, -d.r, -d.r, d.r * 2, d.r * 2);
                }
                ctx.restore();
            }
        });

        if (!this.backgroundLoaded) return requestAnimationFrame(t => this.loop(t));
        
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

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
        gl.uniform1f(loc("u_fog"), CONFIG.fogIntensity);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(t => this.loop(t));
    };

    window.addEventListener('load', () => {
        const renderer = new RainRenderer(document.getElementById('container'));
        window.rainEngine = renderer;
        renderer.init();
    });

    window.addEventListener('resize', () => {
        if(window.rainEngine) window.rainEngine.resize();
    });
})();
