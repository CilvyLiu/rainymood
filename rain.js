'use strict';

(function() {
    /**
     * 第一步：First - 配置仿真参数
     * 整合了附件 simulator.ts 中的物理常量
     */
    const CONFIG = {
        gravity: 2400,            // 重力加速度
        spawnInterval: [0.1, 0.2], // 生成间隔 (秒)
        spawnSize: [15, 35],      // 初始雨滴大小
        trailDistance: [20, 40],   // 产生拖尾的距离阈值
        refraction: 0.6,          // WebGL 折射强度
        alphaMultiply: 30.0,      // 边缘对比度
        alphaSubtract: 0.2        // 剔除微小水汽
    };

    /**
     * 第二步：Next - 物理引擎核心 (参考附件 raindrop.ts)
     */
    class RainDrop {
        constructor(x, y, size, ratio) {
            this.x = x;
            this.y = y;
            this.r = size * ratio;
            this.mass = Math.pow(this.r, 2);
            this.velocity = 0;
            this.terminated = false;
            this.lastTrailY = y;
            this.nextTrailDist = (Math.random() * (CONFIG.trailDistance[1] - CONFIG.trailDistance[0]) + CONFIG.trailDistance[0]) * ratio;
        }

        update(dt, height) {
            // 模拟阻力：体积越大阻力越大
            const resistance = Math.pow(this.r, 1.2) * 0.1;
            const accel = CONFIG.gravity - resistance;
            this.velocity += accel * dt;
            this.y += this.velocity * dt;

            // 检查是否需要留下拖尾 (Split 逻辑)
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
        this.staticDrops = []; // 存储拖尾
        this.lastTime = 0;
        this.spawnTimer = 0;
        
        this.init();
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        
        // Shader 保持高效折射运算
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
        
        // 生成模拟法线的雨滴形状贴图
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
                    img.data[i] = (dx * 0.5 + 0.5) * 255;   // R: X 偏移
                    img.data[i+1] = (dy * 0.5 + 0.5) * 255; // G: Y 偏移
                    img.data[i+2] = f * 255;               // B: 高光
                    img.data[i+3] = f * 255;               // A: 蒙版
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

        // 生成器
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            const size = (Math.random() * (CONFIG.spawnSize[1] - CONFIG.spawnSize[0]) + CONFIG.spawnSize[0]);
            this.drops.push(new RainDrop(Math.random() * this.waterCanvas.width, -100, size, this.ratio));
            this.spawnTimer = Math.random() * (CONFIG.spawnInterval[1] - CONFIG.spawnInterval[0]) + CONFIG.spawnInterval[0];
        }

        const ctx = this.waterCtx;
        ctx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);

        // 绘制拖尾 (静止小水滴)
        for (let i = this.staticDrops.length - 1; i >= 0; i--) {
            let s = this.staticDrops[i];
            s.r -= dt * 2; // 缓慢蒸发
            if (s.r < 1) { this.staticDrops.splice(i, 1); continue; }
            ctx.drawImage(this.dropShape, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
        }

        // 更新并绘制主雨滴
        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            if (d.update(dt, this.waterCanvas.height)) {
                this.staticDrops.push({ x: d.x, y: d.y, r: d.r * 0.3 });
            }

            // 碰撞融合逻辑 (Merge)
            for (let j = 0; j < this.drops.length; j++) {
                let other = this.drops[j];
                if (d === other || other.terminated) continue;
                let dist = Math.hypot(d.x - other.x, d.y - other.y);
                if (dist < (d.r + other.r) * 0.7) {
                    if (d.r >= other.r) {
                        d.r = Math.min(d.r + other.r * 0.15, 70 * this.ratio);
                        other.terminated = true;
                    }
                }
            }

            if (d.terminated) { this.drops.splice(i, 1); continue; }
            
            // 绘制拉长的下落雨滴
            ctx.drawImage(this.dropShape, d.x - d.r * 0.8, d.y - d.r, d.r * 1.6, d.r * 3.5);
        }

        // WebGL 混合
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        const loc = (n) => gl.getUniformLocation(this.prog, n);
        gl.uniform1i(loc("u_water"), 1);
        gl.uniform1f(loc("u_ref"), CONFIG.refraction);
        gl.uniform1f(loc("u_aMult"), CONFIG.alphaMultiply);
        gl.uniform1f(loc("u_aSub"), CONFIG.alphaSubtract);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(t => this.loop(t));
    };

    /**
     * 最后：Finally - 场景切换逻辑 (完整保留并增强)
     */
    window.addEventListener('load', () => {
        const container = document.getElementById('container');
        if(!container) return;

        const renderer = new RainRenderer(container);
        renderer.updateBackground('pensive.png');
        window.rainEngine = renderer;
        
        window.addEventListener('resize', () => renderer.resize());

        // 场景切换全局函数
        window.changeScene = (url) => {
            // 1. 更新背景贴图
            renderer.updateBackground(url);
            
            // 2. 音频同步切换
            const asc = document.getElementById('audio_scene');
            if(asc) {
                const audioSrc = url.split('.')[0] + '.mp3'; 
                asc.src = audioSrc;
                asc.play().catch(() => console.log("等待用户交互后播放音频"));
            }
            
            // 3. UI 状态同步
            const pbtn = document.getElementById('pbtn');
            if(pbtn) pbtn.innerText = "⏸";
        };
    });
})();
