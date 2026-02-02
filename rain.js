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
            this.lastTrailY = y;
            this.lastTrailX = x;
            this.windSensitivity = Math.random() * 0.5 + 0.8;
            this.shifting = (Math.random() - 0.5) * (size * 0.4);
            this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
            this.phase = Math.random() * Math.PI * 2;
        }

        update(dt, height) {
            const currentGravity = this.engine.customGravity || CONFIG.gravity;
            const baseWind = (this.engine.spawnChance > 0.5) ? 600 : 200;
            const windAccel = baseWind * this.windSensitivity;
            const friction = 0.003 * this.r;
            
            this.vy += (currentGravity - (this.vy * friction)) * dt;
            this.vx += (windAccel - (this.vx * friction)) * dt;

            this.y += this.vy * dt;
            this.x += this.vx * dt + Math.sin(this.y * 0.04 + this.phase) * (this.shifting * dt);

            const distMoved = Math.sqrt(Math.pow(this.y - this.lastTrailY, 2) + Math.pow(this.x - this.lastTrailX, 2));
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
        this.gl = this.canvas.getContext('webgl', { alpha: false });
        this.drops = [];
        this.staticDrops = [];
        this.lastTime = 0;
        this.backgroundLoaded = false;
        
        // 联动参数
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
        const shader = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); gl.attachShader(prog, h); };
        shader(gl.VERTEX_SHADER, vs); shader(gl.FRAGMENT_SHADER, fs);
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
        this.updateBackground('pensive.png'); // 默认加载
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
                let dx = (x - 32) / 32, dy = (y - 32) / 32;
                let dist = Math.sqrt(dx * dx * 1.2 + dy * dy * (dy > 0 ? 0.8 : 1.2));
                let i = (y * size + x) * 4;
                if (dist <= 1.0) {
                    let f = Math.pow(1.0 - dist, 1.5);
                    img.data[i] = (dx * 0.5 + 0.5) * 255;
                    img.data[i+1] = (dy * 0.5 + 0.5) * 255;
                    img.data[i+2] = f * 255;
                    img.data[i+3] = f * 255;
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
        // 如果图片加载失败，给一个深色的兜底图，确保雨滴可见
        img.onerror = () => {
            const dummy = document.createElement('canvas');
            dummy.width = dummy.height = 2;
            const dctx = dummy.getContext('2d');
            dctx.fillStyle = '#111'; dctx.fillRect(0,0,2,2);
            this.bgImage = dummy;
            this.backgroundLoaded = true;
        };
        img.src = url;
    };

    RainRenderer.prototype.loop = function(now) {
        const dt = Math.min((now - this.lastTime) / 1000, 0.033);
        this.lastTime = now;

        if (Math.random() < this.spawnChance) {
            const r = this.sizeRange;
            const size = Math.random() * (r[1] - r[0]) + r[0];
            this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -100, size, this.ratio, this));
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        // 合并逻辑
        this.drops.sort((a,b) => a.y - b.y);
        for(let i=0; i<this.drops.length; i++) {
            for(let j=i+1; j<this.drops.length; j++) {
                let d1 = this.drops[i], d2 = this.drops[j];
                if(d1.terminated || d2.terminated) continue;
                let dist = Math.sqrt(Math.pow(d1.x-d2.x,2)+Math.pow(d1.y-d2.y,2));
                if(dist < (d1.r + d2.r)*0.8) { d2.r += d1.r*0.2; d1.terminated = true; }
            }
        }

        // 绘制逻辑
        [this.staticDrops, this.drops].forEach((list, idx) => {
            for (let i = list.length - 1; i >= 0; i--) {
                let d = list[i];
                if (idx === 0) d.r -= dt * this.fadeSpeed; // static
                else if (d.update(dt, this.waterCanvas.height)) {
                    this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.4, initialAngle: Math.atan2(d.vx, d.vy) });
                }
                if (d.terminated || d.r < 1) { list.splice(i, 1); continue; }

                ctx.save();
                ctx.translate(d.x, d.y);
                if (idx === 1) ctx.rotate(-Math.atan2(d.vx, d.vy));
                ctx.drawImage(this.dropShape, -d.r, -d.r, d.r * 2, d.r * 2);
                ctx.restore();
            }
        });

        if (!this.backgroundLoaded) return requestAnimationFrame(t => this.loop(t));
        
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);

        const loc = (n) => gl.getUniformLocation(this.prog, n);
        gl.uniform1i(loc("u_bg"), 0); gl.uniform1i(loc("u_water"), 1);
        gl.uniform2f(loc("u_res"), this.canvas.width, this.canvas.height);
        gl.uniform2f(loc("u_bgRes"), this.bgImage.width || 1, this.bgImage.height || 1);
        gl.uniform1f(loc("u_ref"), CONFIG.refraction);
        gl.uniform1f(loc("u_aMult"), CONFIG.alphaMultiply);
        gl.uniform1f(loc("u_aSub"), CONFIG.alphaSubtract);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(t => this.loop(t));
    };

    window.addEventListener('load', () => {
        new RainRenderer(document.getElementById('container'));
    });
})();
