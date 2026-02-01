'use strict';

(function() {
    // 模拟源码的配置参数
    const config = {
        brightness: 1.1,      // 稍微提高雨滴亮度
        alphaMultiply: 10.0,  // 提高对比度
        alphaSubtract: 1.5,   // 关键：减小这个值，让雨滴痕迹变厚
        refraction: 0.5       // 增加折射率，让变形更明显
    };

    // 动态生成源码要求的形状贴图，确保即便没有外部 png 也能正常产生雨滴形状
    function createDropTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        // R: X偏移, G: Y偏移, B: 亮度, A: 混合度
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.5, 'rgba(128, 128, 255, 0.5)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        return canvas;
    }

    function RainRenderer(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        container.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl', { alpha: false, depth: false });
        this.dropImg = createDropTexture();
        this.ratio = window.devicePixelRatio || 1;
        this.drops = [];
        this.options = { rainChance: 0.4, minR: 10, maxR: 25, baseSpeed: 4 };
        this.init();
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        const vs = 'attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}';
        // 核心：基于源码的折射与亮度混合算法
        const fs = `
            precision mediump float;
            uniform sampler2D u_bg, u_water;
            varying vec2 v;
            uniform float u_br, u_aMult, u_aSub, u_ref;
            void main() {
                vec4 water = texture2D(u_water, v);
                vec2 offset = (water.rg - 0.5) * u_ref;
                float alpha = clamp(water.a * u_aMult - u_aSub, 0.0, 1.0);
                vec4 bg = texture2D(u_bg, v + offset);
                gl_FragColor = mix(bg, bg * u_br + water.b * 0.2, alpha);
            }
        `;
        
        const prog = gl.createProgram();
        const addSh = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); gl.attachShader(prog, h); };
        addSh(gl.VERTEX_SHADER, vs); addSh(gl.FRAGMENT_SHADER, fs);
        gl.linkProgram(prog); gl.useProgram(prog);
        this.prog = prog;

        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
        this.dropCanvas = document.createElement('canvas');
        this.dropCtx = this.dropCanvas.getContext('2d');

        // 顶点数据
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const p = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

        this.resize();
        this.loop();
    };

    RainRenderer.prototype.resize = function() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    
    // 逻辑尺寸
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    
    // 物理像素尺寸：必须完全一致
    const realW = Math.floor(this.width * this.ratio);
    const realH = Math.floor(this.height * this.ratio);
    
    this.canvas.width = this.dropCanvas.width = realW;
    this.canvas.height = this.dropCanvas.height = realH;
    
    this.gl.viewport(0, 0, realW, realH);
};;

  RainRenderer.prototype.updateBackground = function(url) {
        const gl = this.gl;
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, this.texBg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        };
        img.src = url;
    };

    RainRenderer.prototype.loop = function() {
        // 1. 生成新雨滴
        if (Math.random() < this.options.rainChance) {
            this.drops.push({
                x: Math.random() * this.dropCanvas.width,
                y: -100,
                r: (Math.random() * (this.options.maxR - this.options.minR) + this.options.minR) * this.ratio,
                // baseSpeed 来自 HTML 切换，如果没有则默认为 4
                v: ((this.options.baseSpeed || 4) + Math.random() * 2) * this.ratio
            });
        }

        // 2. 离屏绘制：实现拖尾水痕的核心
        // 用半透明黑色覆盖，不使用 clearRect，让上一帧的雨滴留下淡淡的影迹
        this.dropCtx.fillStyle = 'rgba(0, 0, 0, 0.18)'; 
        this.dropCtx.fillRect(0, 0, this.dropCanvas.width, this.dropCanvas.height);

        this.dropCtx.globalAlpha = 0.7; // 降低水滴直接绘制的透明度，增强融合感
        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            d.y += d.v; 
            
            // 关键：将雨滴拉伸为长椭圆（梭形），宽度设为 r 的 0.8 倍，高度设为 2.5 倍
            this.dropCtx.drawImage(
                this.dropImg, 
                d.x - d.r * 0.4, d.y - d.r, 
                d.r * 0.8, d.r * 2.5
            );

            if (d.y > this.dropCanvas.height + 100) this.drops.splice(i, 1);
        }
        this.dropCtx.globalAlpha = 1.0;

        // 3. WebGL 最终合成渲染
        const gl = this.gl;
        gl.useProgram(this.prog);

        // 激活并绑定背景
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.uniform1i(gl.getUniformLocation(this.prog, "u_bg"), 0);

        // 激活并上传雨滴纹理
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.dropCanvas);
        gl.uniform1i(gl.getUniformLocation(this.prog, "u_water"), 1);

        // 绑定配置参数 (注意：这里使用全局定义的 config)
        const loc = (n) => gl.getUniformLocation(this.prog, n);
        gl.uniform1f(loc("u_br"), 1.1);         // 亮度调节
        gl.uniform1f(loc("u_aMult"), 8.0);      // 边缘对比度
        gl.uniform1f(loc("u_aSub"), 1.2);       // 留痕削减量（越小留痕越久）
        gl.uniform1f(loc("u_ref"), 0.4);        // 折射率

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(this.loop.bind(this));
    };

    window.addEventListener('load', () => {
        const container = document.getElementById('container');
        if(!container) return;

        const renderer = new RainRenderer(container);
        renderer.updateBackground('pensive.png');
        window.rainEngine = renderer;
        
        window.addEventListener('resize', () => renderer.resize());

        // 对接 HTML 的切换场景函数
        window.changeScene = (url) => {
            renderer.updateBackground(url);
            const asc = document.getElementById('audio_scene');
            if(!asc) return;
            if(url === 'pensive.png') {
                asc.pause();
            } else {
                asc.src = url.split('.')[0] + '.m4a';
                asc.play().catch(() => { console.log("Audio waiting for user interaction"); });
            }
        };
    });
})();
