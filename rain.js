'use strict';

(function() {
    // 动态生成雨滴纹理，不再依赖外部图片文件
    function createDropTextures() {
        const size = 64;
        const alphaCanvas = document.createElement('canvas');
        const colorCanvas = document.createElement('canvas');
        alphaCanvas.width = alphaCanvas.height = colorCanvas.width = colorCanvas.height = size;
        
        const actx = alphaCanvas.getContext('2d');
        const cctx = colorCanvas.getContext('2d');

        // 画一个径向渐变的球体作为雨滴
        const grad = actx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.3)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        
        actx.fillStyle = grad;
        actx.fillRect(0,0,size,size);

        // 颜色纹理（提供折射感所需的RG通道）
        cctx.fillStyle = 'rgb(128,128,255)'; // 法线贴图基色
        cctx.fillRect(0,0,size,size);

        return { alpha: alphaCanvas, color: colorCanvas };
    }

    function Raindrops(width, height, scale, textures) {
        this.width = width; this.height = height; this.scale = scale;
        this.textures = textures;
        this.drops = [];
        this.canvas = document.createElement('canvas');
        this.canvas.width = width * scale;
        this.canvas.height = height * scale;
        this.ctx = this.canvas.getContext('2d');
        this.options = { minR: 15, maxR: 40, rainChance: 0.6 };
    }

    Raindrops.prototype.update = function(delta) {
        if (Math.random() < this.options.rainChance * delta) {
            this.drops.push({ x: Math.random() * this.width, y: -50, r: Math.random() * (this.options.maxR - this.options.minR) + this.options.minR, v: Math.random() * 4 + 4 });
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drops.forEach((d, i) => {
            d.y += d.v;
            const s = d.r * 2 * this.scale;
            this.ctx.drawImage(this.textures.alpha, (d.x - d.r) * this.scale, (d.y - d.r) * this.scale, s, s);
            if (d.y > this.height + 100) this.drops.splice(i, 1);
        });
    };

    function RainRenderer(container) {
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'width:100%; height:100%; display:block;';
        container.appendChild(this.canvas);
        this.gl = this.canvas.getContext('webgl', { alpha: true });
        this.textures = createDropTextures();
        this.scale = window.devicePixelRatio || 1;
        this.init();
    }

    RainRenderer.prototype.init = function() {
        const gl = this.gl;
        const vs = 'attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}';
        // 强化 Shader：让雨滴的折射边缘极其明亮
        const fs = 'precision mediump float;varying vec2 v;uniform sampler2D b,w;void main(){vec4 r=texture2D(w,v);vec2 o=(r.rg-0.5)*0.3; if(r.a>0.01){gl_FragColor=texture2D(b,v+o)+r.a*0.4;}else{gl_FragColor=texture2D(b,v);}}';
        
        const prog = gl.createProgram();
        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, i) => {
            const sh = gl.createShader(type); gl.shaderSource(sh, i===0?vs:fs); gl.compileShader(sh); gl.attachShader(prog, sh);
        });
        gl.linkProgram(prog); gl.useProgram(prog);
        this.prog = prog;
        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
        
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        const p = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

        this.raindrops = new Raindrops(this.container.clientWidth, this.container.clientHeight, this.scale, this.textures);
        this.resize();
        this.draw();
    }

    RainRenderer.prototype.resize = function() {
        this.canvas.width = this.container.clientWidth * this.scale;
        this.canvas.height = this.container.clientHeight * this.scale;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    };

    RainRenderer.prototype.updateBackground = function(src) {
        const gl = this.gl;
        const img = new Image();
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_2D, this.texBg);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        };
        img.src = src;
    };

    RainRenderer.prototype.draw = function() {
        this.raindrops.update(1.0);
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.raindrops.canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.uniform1i(gl.getUniformLocation(this.prog, "b"), 0);
        gl.uniform1i(gl.getUniformLocation(this.prog, "w"), 1);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(this.draw.bind(this));
    };

    // 初始化启动
    window.addEventListener('load', () => {
        const container = document.getElementById('container');
        const renderer = new RainRenderer(container);
        renderer.updateBackground('pensive.png');
        window.rainEngine = renderer;
        
        window.changeScene = function(url) {
            renderer.updateBackground(url);
            const abg = document.getElementById('audio_bg');
            const asc = document.getElementById('audio_scene');
            if(abg.paused) abg.play();
            if(url === 'pensive.png') { asc.pause(); } 
            else { asc.src = url.split('.')[0] + '.m4a'; asc.play(); }
        };
    });
})();
