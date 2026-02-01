'use strict';

(function() {
    // 1. 核心：动态生成具有“折射属性”的雨滴纹理
    function createDropTextures() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');

        // 清除透明
        ctx.clearRect(0, 0, size, size);

        // 创建径向渐变：RG通道存储偏移量，B通道存储高光，A通道存储范围
        const centerX = size / 2;
        const centerY = size / 2;
        const radius = size / 2;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - centerX;
                const dy = y - centerY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < radius) {
                    const amt = 1.0 - (distance / radius);
                    // R: X轴偏移, G: Y轴偏移, B: 亮度/高光, A: 透明度门槛
                    const r = 128 + (dx / radius) * 127; 
                    const g = 128 + (dy / radius) * 127;
                    const b = amt * 255;
                    const a = amt * 255;
                    ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`;
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
        return canvas;
    }

    function RainRenderer(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        container.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl', { alpha: false });
        this.dropTexImg = createDropTextures();
        this.scale = window.devicePixelRatio || 1;
        this.drops = [];
        this.init();
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        const vs = 'attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}';
        // 关键点：o 是偏移向量。如果 r.a 够大，就扭曲 v (纹理坐标)
        const fs = 'precision mediump float;varying vec2 v;uniform sampler2D b,w;void main(){vec4 r=texture2D(w,v);vec2 o=(r.rg-0.5)*0.3;if(r.a>0.1){gl_FragColor=texture2D(b,v+o)+r.b*0.4;}else{gl_FragColor=texture2D(b,v);}}';
        
        const prog = gl.createProgram();
        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, i) => {
            const sh = gl.createShader(type); gl.shaderSource(sh, i===0?vs:fs); gl.compileShader(sh); gl.attachShader(prog, sh);
        });
        gl.linkProgram(prog); gl.useProgram(prog);
        this.prog = prog;

        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
        
        // 离屏 Canvas 画布：用于汇集所有飞舞的雨滴
        this.dropCanvas = document.createElement('canvas');
        this.dropCtx = this.dropCanvas.getContext('2d');

        this.resize();
        this.loop();
    };

    RainRenderer.prototype.resize = function() {
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        this.canvas.width = this.dropCanvas.width = this.width * this.scale;
        this.canvas.height = this.dropCanvas.height = this.height * this.scale;
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
        // 1. 在离屏画布上生成雨滴信号
        if (Math.random() < 0.5) { // 提高概率
            this.drops.push({
                x: Math.random() * this.dropCanvas.width,
                y: -100,
                r: (Math.random() * 20 + 15) * this.scale,
                v: (Math.random() * 5 + 7) * this.scale
            });
        }

        this.dropCtx.clearRect(0, 0, this.dropCanvas.width, this.dropCanvas.height);
        for (let i = this.drops.length - 1; i >= 0; i--) {
            let d = this.drops[i];
            d.y += d.v;
            this.dropCtx.drawImage(this.dropTexImg, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
            if (d.y > this.dropCanvas.height + 100) this.drops.splice(i, 1);
        }

        // 2. 将数据上传至 WebGL
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.dropCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.uniform1i(gl.getUniformLocation(this.prog, "b"), 0);
        gl.uniform1i(gl.getUniformLocation(this.prog, "w"), 1);

        // 顶点缓冲数据
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

        window.changeScene = (url) => {
            renderer.updateBackground(url);
            const bg = document.getElementById('audio_bg');
            const sc = document.getElementById('audio_scene');
            bg.play().catch(e => {});
            if(url === 'pensive.png') sc.pause();
            else { sc.src = url.split('.')[0] + '.m4a'; sc.play().catch(e => {}); }
        };
    });
})();
