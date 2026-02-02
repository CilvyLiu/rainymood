'use strict';

(function() {
    const CONFIG = {
        gravity: 1200,
        trailDistance: [10, 35],
        refraction: 0.5,
        alphaMultiply: 20.0,
        alphaSubtract: 0.1,
        fogIntensity: 0.35, // 水汽浓度
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
            const gust = Math.sin(time * 0.0004) * 350 + Math.sin(time * 0.0011) * 100;
            const windForce = gust * this.windSensitivity;

            const terminalVelocity = 900 + this.r * 15;
            const resistance = (this.vy / terminalVelocity);
            const netAccel = currentGravity * (1 - resistance * resistance);

            this.vy += netAccel * dt;
            this.vx += (windForce - this.vx * 0.8) * dt; 

            this.y += this.vy * dt;
            this.x += this.vx * dt;

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
        this.spawnChance = 0.15; 
        this.sizeRange = [10, 30];
        this.fadeSpeed = 1.8; 
    }

    RainRenderer.prototype.resize = function() {
        this.ratio = window.devicePixelRatio || 1;
        this.canvas.width = window.innerWidth * this.ratio;
        this.canvas.height = window.innerHeight * this.ratio;
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
                let dist = Math.sqrt(dx * dx + dy * dy * (dy > 0 ? 0.85 : 1.2)); 
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
                
                vec4 bg = texture2D(u_bg, uv + offset);
                
                // 水汽效果：混合背景和淡蓝色雾气
                vec3 fogCol = vec3(0.9, 0.95, 1.0);
                float alpha = clamp(water.a * u_aMult - u_aSub, 0.0, 1.0);
                
                // 洗刷逻辑：雨滴覆盖的地方(alpha > 0)，fog 效果降低
                float fogAmt = u_fog * (1.0 - alpha);
                vec3 scene = mix(bg.rgb, fogCol, fogAmt);
                
                gl_FragColor = vec4(scene + pow(water.b, 2.5) * 0.4, 1.0);
            }
        `;

        const prog = gl.createProgram();
        const shader = (t, s) => { 
            const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); gl.attachShader(prog, h); 
        };
        shader(gl.VERTEX_SHADER, vs); shader(gl.FRAGMENT_SHADER, fs);
        gl.linkProgram(prog); gl.useProgram(prog);
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

        if (Math.random() < this.spawnChance) {
            const size = Math.random() * (this.sizeRange[1] - this.sizeRange[0]) + this.sizeRange[0];
            this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -100, size, this.ratio, this));
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        [this.staticDrops, this.drops].forEach((list, idx) => {
            for (let i = list.length - 1; i >= 0; i--) {
                let d = list[i];
                if (idx === 0) d.r -= dt * this.fadeSpeed;
                else if (d.update(dt, this.waterCanvas.height, now)) {
                    this.staticDrops.push({ x: d.x, y: d.y, r: d.r * (Math.random() * 0.2 + 0.3), terminated: false });
                }
                if (d.terminated || d.r < 0.5) { list.splice(i, 1); continue; }

                ctx.save();
                ctx.translate(d.x, d.y);
                if (idx === 1) {
                    const angle = Math.atan2(d.vy, d.vx);
                    ctx.rotate(angle - Math.PI / 2);
                    const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
                    const stretch = Math.min(speed * 0.03, d.r * 0.5);
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
    });

    window.addEventListener('resize', () => {
        if(window.rainEngine) window.rainEngine.resize();
    });
})();
