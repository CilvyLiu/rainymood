/**
 * Nova's Pensieve - Ultra Rain Engine
 * 集成：物理碰撞、拖尾、闪电、视差、天气系统
 */

class RainEngine {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = document.createElement('canvas');
        this.container.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        
        // 核心物理参数
        this.options = {
            raining: true,
            minR: 20,
            maxR: 50,
            rainChance: 0.35,
            rainLimit: 6,
            dropletsRate: 50,
            trailRate: 1,
            collisionRadius: 0.45,
            collisionRadiusIncrease: 0.0002,
            parallaxX: 0,
            parallaxY: 0,
            flashChance: 0
        };

        this.drops = [];
        this.lastTime = 0;
        this.parallax = { x: 0, y: 0 };
        
        // 离屏绘图层
        this.waterCanvas = document.createElement('canvas');
        this.waterCtx = this.waterCanvas.getContext('2d');
        
        this.init();
    }

    init() {
        this.resize();
        this.setupWebGL();
        this.initEvents();
        this.animate();
    }

    // 1. 响应式布局
    resize() {
        const t = window.devicePixelRatio || 1;
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width * t;
        this.canvas.height = this.height * t;
        this.waterCanvas.width = this.canvas.width;
        this.waterCanvas.height = this.canvas.height;
        if (this.gl) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    // 2. 视差监听：增加“深潜”的沉浸感
    initEvents() {
        document.addEventListener('mousemove', (e) => {
            this.parallax.x = (e.pageX / window.innerWidth) * 2 - 1;
            this.parallax.y = (e.pageY / window.innerHeight) * 2 - 1;
        });
    }

    setupWebGL() {
        const gl = this.gl;
        const vs = `attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}`;
        const fs = `
            precision mediump float;
            varying vec2 v;
            uniform sampler2D b, w;
            uniform vec2 u_parallax;
            void main(){
                vec2 pCoord = v + u_parallax * 0.02; // 背景视差
                vec4 r = texture2D(w, v);
                vec2 o = (r.rg - 0.5) * 0.15;
                if(r.a > 0.0){
                    gl_FragColor = texture2D(b, pCoord + o) + r.b * 0.1;
                } else {
                    gl_FragColor = texture2D(b, pCoord);
                }
            }`;

        this.prog = gl.createProgram();
        const add = (src, type) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(this.prog, s);
        };
        add(vs, gl.VERTEX_SHADER); add(fs, gl.FRAGMENT_SHADER);
        gl.linkProgram(this.prog); gl.useProgram(this.prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const pLoc = gl.getAttribLocation(this.prog, 'p');
        gl.enableVertexAttribArray(pLoc);
        gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
    }

    updateBackground(src) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        img.onload = () => {
            const gl = this.gl;
            gl.bindTexture(gl.TEXTURE_2D, this.texBg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        };
    }

    // 3. 接下来：模拟真实碰撞与融合
    updatePhysics() {
        if (this.options.raining && Math.random() < this.options.rainChance) {
            for(let i=0; i<this.options.rainLimit; i++) {
                if(Math.random() < 0.2) {
                    this.drops.push({
                        x: Math.random() * this.waterCanvas.width,
                        y: -50,
                        r: Math.random() * (this.options.maxR - this.options.minR) + this.options.minR,
                        v: Math.random() * 5 + 2,
                        lastSpawn: 0
                    });
                }
            }
        }

        this.waterCtx.clearRect(0, 0, this.waterCanvas.width, this.waterCanvas.height);
        this.waterCtx.globalCompositeOperation = 'source-over';

        for (let i = this.drops.length - 1; i >= 0; i--) {
            const d = this.drops[i];
            d.y += d.v;
            
            // 绘制雨滴
            const g = this.waterCtx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
            g.addColorStop(0, 'rgba(128, 128, 255, 1)');
            g.addColorStop(0.8, 'rgba(128, 128, 255, 0.4)');
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.waterCtx.fillStyle = g;
            this.waterCtx.beginPath();
            this.waterCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            this.waterCtx.fill();

            // 实现拖尾：在路径上留下微小水滴
            d.lastSpawn += d.v;
            if(d.lastSpawn > d.r * 2 * this.options.trailRate) {
                // 这里可以扩展生成静止的小水滴
                d.lastSpawn = 0;
            }

            // 碰撞检测
            for (let j = i - 1; j >= 0; j--) {
                const o = this.drops[j];
                const dist = Math.hypot(d.x - o.x, d.y - o.y);
                if (dist < (d.r + o.r) * this.options.collisionRadius) {
                    d.r = Math.sqrt(d.r * d.r + o.r * o.r);
                    d.v += 0.5; // 融合后由于重量增加，动量增加
                    this.drops.splice(j, 1);
                    i--;
                }
            }
            if (d.y > this.waterCanvas.height + 100) this.drops.splice(i, 1);
        }

        // 闪电逻辑
        if(this.options.flashChance > 0 && Math.random() < this.options.flashChance) {
            this.container.style.filter = 'brightness(3) contrast(1.2)';
            setTimeout(() => this.container.style.filter = 'none', 50);
        }
    }

    animate() {
        this.updatePhysics();
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.waterCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        
        gl.uniform2f(gl.getUniformLocation(this.prog, "u_parallax"), this.parallax.x, this.parallax.y);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.uniform1i(gl.getUniformLocation(this.prog, "b"), 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.uniform1i(gl.getUniformLocation(this.prog, "w"), 1);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(() => this.animate());
    }
}

window.rainEngine = new RainEngine('container');
