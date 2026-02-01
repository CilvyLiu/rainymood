'use strict';

(function() {
    // 1. 完全对照源码的配置参数
    const options = {
        minR: 20, maxR: 50,
        rainChance: 0.35,
        brightness: 1.04,
        alphaMultiply: 6,
        alphaSubtract: 3,
        parallaxBg: 5,
        parallaxFg: 20
    };

    // 2. 动态生成源码要求的“双重纹理”
    function createTexturePack() {
        const size = 64;
        const alpha = document.createElement('canvas');
        alpha.width = alpha.height = size;
        const actx = alpha.getContext('2d');
        const grad = actx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        actx.fillStyle = grad;
        actx.fillRect(0,0,size,size);

        const color = document.createElement('canvas');
        color.width = color.height = size;
        const cctx = color.getContext('2d');
        cctx.fillStyle = 'rgb(128,128,255)'; // 源码要求的法线基色
        cctx.fillRect(0,0,size,size);

        return { alpha, color };
    }

    function RainRenderer(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        container.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl');
        this.ratio = window.devicePixelRatio || 1;
        this.textures = createTexturePack();
        this.drops = [];
        this.init();
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        // 3. 严格对照源码中的 GLSL 片元着色器
        const vs = 'attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}';
        const fs = `
            precision mediump float;
            uniform sampler2D u_bg, u_water;
            varying vec2 v;
            uniform float u_brightness, u_alphaMult, u_alphaSub;
            void main() {
                vec4 water = texture2D(u_water, v);
                vec2 offset = (water.rg - 0.5) * 0.2; // 模拟折射
                float alpha = clamp(water.a * u_alphaMult - u_alphaSub, 0.0, 1.0);
                vec4 bg = texture2D(u_bg, v + offset);
                gl_FragColor = mix(bg, bg * u_brightness + water.b * 0.2, alpha);
            }
        `;
        
        const prog = gl.createProgram();
        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, i) => {
            const sh = gl.createShader(type); gl.shaderSource(sh, i===0?vs:fs); gl.compileShader(sh); gl.attachShader(prog, sh);
        });
        gl.linkProgram(prog); gl.useProgram(prog);
        this.prog = prog;

        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
        
        this.dropCanvas = document.createElement('canvas');
        this.dropCtx = this.dropCanvas.getContext('2d');

        this.resize();
        this.loop();
    };

    RainRenderer.prototype.resize = function() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.dropCanvas.width = this.width * this.ratio;
        this.canvas.height = this.dropCanvas.height = this.height * this.ratio;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    };

    RainRenderer.prototype.updateBackground = function(url) {
        const gl = this.gl;
        const img = new Image();
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, this.texBg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        };
        img.src = url;
    };

    RainRenderer.prototype.loop = function() {
        // 4. 模拟源码中的 Drop 生成逻辑
        if (Math.random() < options.rainChance) {
            this.drops.push({
                x: Math.random() * this.dropCanvas.width,
                y: -100,
                r: (Math.random() * (options.maxR - options.minR) + options.minR) * this.ratio,
                v: (Math.random() * 5 + 5) * this.ratio
            });
        }

        this.dropCtx.clearRect(0, 0, this.dropCanvas.width, this.dropCanvas.height);
        this.drops.forEach((d, i) => {
            d.y += d.v;
            // 模仿源码的叠加绘图
            this.dropCtx.drawImage(this.textures.alpha, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
            if (d.y > this.dropCanvas.height + 100) this.drops.splice(i, 1);
        });

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.dropCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        
        // 传 Uniform 变量
        gl.uniform1i(gl.getUniformLocation(this.prog, "u_bg"), 0);
        gl.uniform1i(gl.getUniformLocation(this.prog, "u_water"), 1);
        gl.uniform1f(gl.getUniformLocation(this.prog, "u_brightness"), options.brightness);
        gl.uniform1f(gl.getUniformLocation(this.prog, "u_alphaMult"), options.alphaMultiply);
        gl.uniform1f(gl.getUniformLocation(this.prog, "u_alphaSub"), options.alphaSubtract);

        // 顶点缓冲 (Fullscreen Quad)
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const p = gl.getAttribLocation(this.prog, 'p');
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(this.loop.bind(this));
    };

    window.addEventListener('load', () => {
        const renderer = new RainRenderer(document.getElementById('container'));
        renderer.updateBackground('pensive.png');
        window.rainEngine = renderer;
    });
})();
