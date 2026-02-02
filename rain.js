'use strict';

(function() {
    const CONFIG = {
        gravity: 2400,
        trailDistance: [20, 35], 
        refraction: 0.5,         
        alphaMultiply: 20.0,    
        alphaSubtract: 0.1,     
        spawnInterval: 0.1,    
    };

    class RainDrop {
        constructor(x, y, size, ratio) {
            this.x = x;
            this.y = y;
            // 核心 1：这里接收生成的随机大小
            this.r = size * ratio; 
            this.velocity = 0;
            this.terminated = false;
            this.lastTrailY = y;
            // 物理特性：大雨滴摆动幅度略大
            this.shifting = (Math.random() - 0.5) * (size * 0.2); 
            this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
        }

        update(dt, height) {
            // 物理 1：增加阻力感，让下落不那么线性
            const resistance = 0.005 * this.r; 
            const accel = CONFIG.gravity - (this.velocity * resistance);
            
            this.velocity += accel * dt;
            this.y += this.velocity * dt;
            
            // 物理 2：让路径微微晃动，不再“太直”
            this.x += Math.sin(this.y * 0.05) * (this.shifting * dt);

            if (this.y - this.lastTrailY > this.nextTrailDist) {
                this.lastTrailY = this.y;
                return true; 
            }
            if (this.y > height + 100) this.terminated = true;
            return false;
        }
    } // RainDrop 类结束

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
        this.init();
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

        // 核心 2：颗粒大小随机改这里
        if (Math.random() < CONFIG.spawnInterval) {
            const minSize = 25; // 最小颗粒
            const maxSize = 85; // 最大颗粒
            const randomSize = Math.random() * (maxSize - minSize) + minSize;
            
            const xPos = Math.random() * this.waterCanvas.width;
            this.drops.push(new RainDrop(xPos, -100, randomSize, this.ratio));
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        for (let i = this.staticDrops.length - 1; i >= 0; i--) {
            let s = this.staticDrops[i];
            s.r -= dt * 2.5; 
            if (s.r < 1) { this.staticDrops.splice(i, 1); continue; }
            ctx.drawImage(this.dropShape, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
        }

        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            if (d.update(dt, this.waterCanvas.height)) {
                this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.4 });
            }
            if (d.terminated) { this.drops.splice(i, 1); continue; }
            
            const stretch = 1.2 + (d.velocity / 2000);
            const w = d.r * 2;
            const h = d.r * 2 * stretch;

            ctx.save();
            ctx.translate(d.x, d.y);
            ctx.rotate(Math.sin(d.y * 0.05) * 0.05); 
            ctx.drawImage(this.dropShape, -w / 2, -h / 2, w, h);
            ctx.restore();
        }

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
