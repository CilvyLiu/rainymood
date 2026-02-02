'use strict';

(function() {
    // 仿真参数
    const CONFIG = {
        gravity: 2400,
        trailDistance: [10, 30],
        refraction: 0.6,
        alphaMultiply: 35.0,
        alphaSubtract: 0.2
    };

    class RainDrop {
        constructor(x, y, size, ratio, baseSpeed) {
            // 1. 初始位置大幅度随机化，打破成排出现的规律
            this.x = x + (Math.random() - 0.5) * 80; 
            this.y = y - Math.random() * 400; 
            
            // 2. 核心修改：尺寸阶梯分布（模拟真实雨水的大小比例）
            // 60% 小雨滴，30% 中雨滴，10% 厚重的大雨滴
            const seed = Math.random();
            let sizeScale = seed > 0.9 ? 1.4 : (seed < 0.6 ? 0.65 : 1.0);
            this.r = size * ratio * sizeScale;
            
            // 3. 物理随机性：大雨滴由于动量大，下落更快，阻力感小
            this.speedOffset = (0.7 + Math.random() * 0.5) * (sizeScale * 0.9);
            this.velocity = (150 + Math.random() * 300) * sizeScale; 
            
            this.terminated = false;
            this.lastTrailY = this.y;
            // 越大的雨滴，留下的水痕间距越长
            this.nextTrailDist = (Math.random() * 20 + 15) * ratio * sizeScale;
        }

        update(dt, height, baseSpeed) {
            const accel = CONFIG.gravity * (baseSpeed / 4) * this.speedOffset; 
            this.velocity += accel * dt;
            this.y += (this.velocity + baseSpeed * 60) * dt;

            // 模拟玻璃表面的微小摆动（去直线化）
            this.x += Math.sin(this.y * 0.03 + this.speedOffset) * 0.4;

            if (this.y - this.lastTrailY > this.nextTrailDist) {
                this.lastTrailY = this.y;
                return true; // 触发拖尾生成
            }
            if (this.y > height + 100) this.terminated = true;
            return false;
        }
    }

    function RainRenderer(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        container.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl', { alpha: true, depth: false });
        
        this.drops = [];
        this.staticDrops = [];
        this.lastTime = 0;
        this.options = { rainChance: 0.5, baseSpeed: 4 };
        
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
                gl_FragColor = mix(bg, bg + water.b * 0.25, alpha);
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

        // 生成率微调，支持尺寸随机传入
        if (Math.random() < this.options.rainChance * 0.2) {
            const baseSize = 18; 
            this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -50, baseSize, this.ratio, this.options.baseSpeed));
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        // 绘制拖尾（保持较圆的形态，模拟滑过后的水渍）
        for (let i = this.staticDrops.length - 1; i >= 0; i--) {
            let s = this.staticDrops[i];
            s.r -= dt * 3.0; 
            if (s.r < 1) { this.staticDrops.splice(i, 1); continue; }
            ctx.drawImage(this.dropShape, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
        }

        // 绘制动态雨滴（长宽比非等比缩放，去除圆形感）
        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            if (d.update(dt, this.waterCanvas.height, this.options.baseSpeed)) {
                this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.4 });
            }
            if (d.terminated) { this.drops.splice(i, 1); continue; }
            
            // 【去圆化核心】：根据下落速度拉伸高度，窄化宽度
            // 速度越快，水滴越长
            const stretchFactor = Math.min(d.velocity / 1200, 1.2);
            const h = d.r * (3.0 + stretchFactor); 
            const w = d.r * (1.3 - stretchFactor * 0.2); 
            
            ctx.drawImage(this.dropShape, d.x - w/2, d.y - h/2, w, h);
        }

        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);

        const loc = (n) => gl.getUniformLocation(this.prog, n);
        gl.uniform1i(loc("u_bg"), 0);
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
        window.rainEngine = renderer;
        renderer.updateBackground('pensive.png'); 
        window.addEventListener('resize', () => renderer.resize());
        // 如果外部有天气切换函数，在此同步
        if(window.changeWeather) window.changeWeather(); 
    });
})();
