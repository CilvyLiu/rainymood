'use strict';

(function() {
    // 默认仿真参数
    const CONFIG = {
        gravity: 2400,
        trailDistance: [20, 40],
        refraction: 0.6,
        alphaMultiply: 30.0,
        alphaSubtract: 0.2
    };

    class RainDrop {
        constructor(x, y, size, ratio, speedOffset) {
            this.x = x;
            this.y = y;
            this.r = size * ratio;
            this.velocity = 0;
            this.speedOffset = speedOffset; // 响应 HTML 中的 baseSpeed
            this.terminated = false;
            this.lastTrailY = y;
            this.nextTrailDist = (Math.random() * 20 + 20) * ratio;
        }

        update(dt, height, baseSpeed) {
            // 基础下落逻辑 + 响应 HTML 的速度设置
            const accel = CONFIG.gravity * (baseSpeed / 4); 
            this.velocity += accel * dt;
            this.y += (this.velocity + baseSpeed * 50) * dt;

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
        this.gl = this.canvas.getContext('webgl', { alpha: false, depth: false });
        
        this.drops = [];
        this.staticDrops = [];
        this.lastTime = 0;
        this.spawnTimer = 0;

        // 【关键】对应 HTML 中的 weatherMap 字段
        this.options = {
            rainChance: 0.4,
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
                gl_FragColor = mix(bg, bg + water.b * 0.2, alpha);
            }
        `;

        const prog = gl.createProgram();
        const addShader = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); gl.attachShader(prog, h); };
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
        };
        img.src = url;
    };

    RainRenderer.prototype.loop = function(now) {
        const dt = Math.min((now - this.lastTime) / 1000, 0.033);
        this.lastTime = now;

        // 响应 rainChance
        if (Math.random() < this.options.rainChance * 0.1) {
            const size = Math.random() * 20 + 15;
            this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -100, size, this.ratio, this.options.baseSpeed));
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        // 绘制拖尾
        for (let i = this.staticDrops.length - 1; i >= 0; i--) {
            let s = this.staticDrops[i];
            s.r -= dt * 2.5; 
            if (s.r < 1) { this.staticDrops.splice(i, 1); continue; }
            ctx.drawImage(this.dropShape, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
        }

        // 更新动态雨滴
        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            if (d.update(dt, this.waterCanvas.height, this.options.baseSpeed)) {
                this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.35 });
            }
            if (d.terminated) { this.drops.splice(i, 1); continue; }
            ctx.drawImage(this.dropShape, d.x - d.r * 0.8, d.y - d.r, d.r * 1.6, d.r * 3.5);
        }

        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);

        const loc = (n) => gl.getUniformLocation(this.prog, n);
        gl.uniform1i(loc("u_water"), 1);
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
        window.rainEngine = renderer;
        
        window.addEventListener('resize', () => renderer.resize());

        // 场景切换函数：联动 HTML 里的 Select
        window.changeScene = (url) => {
            renderer.updateBackground(url);
            const asc = document.getElementById('audio_scene');
            if(asc) {
                asc.src = url.split('.')[0] + '.mp3';
                asc.play().catch(() => {});
            }
            const pbtn = document.getElementById('pbtn');
            if(pbtn) pbtn.innerText = "⏸";
        };
    });
})();
