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
    const center = size / 2;
    ctx.clearRect(0, 0, size, size);
    
    // 增加 B 通道强度（决定水汽感）和 Alpha 饱和度
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0, 'rgba(128, 128, 255, 1.0)'); 
    grad.addColorStop(0.6, 'rgba(128, 128, 255, 0.8)'); 
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)'); 
    
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(center, center, center * 0.9, 0, Math.PI * 2);
    ctx.fill();
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
    this.ratio = window.devicePixelRatio || 1;

    this.container.style.overflow = 'hidden';
    this.canvas.style.position = 'absolute';
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';

    const realW = Math.floor(this.width * this.ratio);
    const realH = Math.floor(this.height * this.ratio);

    this.canvas.width = realW;
    this.canvas.height = realH;
    
    if (this.dropCanvas) {
        this.dropCanvas.width = realW;
        this.dropCanvas.height = realH;
    }

    // 错误修正点：从 gl.viewport 改为 this.gl.viewport
    if (this.gl) {
        this.gl.viewport(0, 0, realW, realH);
    }
};

    RainRenderer.prototype.updateBackground = function(url) {
    const gl = this.gl;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        
        // 关键：设置包裹模式防止图片被强制拉伸/拽大
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    img.src = url;
};

   RainRenderer.prototype.loop = function() {
    // 1. 物理层：生成并更新位置
    if (Math.random() < this.options.rainChance) {
        this.drops.push({
            x: Math.random() * this.dropCanvas.width,
            y: -50, // 初始位置稍微露头
            r: (Math.random() * (this.options.maxR - this.options.minR) + this.options.minR) * this.ratio,
            v: (this.options.baseSpeed + Math.random() * 5) * this.ratio // 确保速度足够大
        });
    }

    // 2. 绘制层：必须彻底清除上一帧
    this.dropCtx.globalCompositeOperation = 'destination-out'; // 关键：先清空
    this.dropCtx.fillStyle = 'rgba(0, 0, 0, 0.1)';           // 产生拖尾留痕
    this.dropCtx.fillRect(0, 0, this.dropCanvas.width, this.dropCanvas.height);
    this.dropCtx.globalCompositeOperation = 'source-over';    // 切回正常模式

    for (let i = this.drops.length - 1; i >= 0; i--) {
        let d = this.drops[i];
        d.y += d.v; // 执行掉落动画

        // 绘制梭形（长条）雨滴，增加高度感 (d.r * 4)
        this.dropCtx.drawImage(
            this.dropImg, 
            d.x - d.r * 0.5, d.y, 
            d.r, d.r * 4
        ); 

        // 越界移除：确保不会在内存堆积
        if (d.y > this.dropCanvas.height + 100) {
            this.drops.splice(i, 1);
        }
    }

    // 3. WebGL 渲染：强制同步纹理
    const gl = this.gl;
    gl.useProgram(this.prog);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texWater);
    // 关键：每一帧必须重新上传
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.dropCanvas);

    const loc = (n) => gl.getUniformLocation(this.prog, n);
    gl.uniform1i(loc("u_water"), 1);
    gl.uniform1f(loc("u_aMult"), 50.0); // 调高对比度，确保能看到
    gl.uniform1f(loc("u_aSub"), 0.05);  // 调低过滤，显示拖尾

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
        // 场景切换
        window.changeScene = (url) => {
    renderer.updateBackground(url);
    const asc = document.getElementById('audio_scene');
    if(!asc) return;
    
    // 自动匹配：pensive.png -> pensive.mp3
    const audioSrc = url.split('.')[0] + '.mp3'; 
    asc.src = audioSrc;
    asc.play().catch(() => console.log("等待交互后播放"));
    
    // 确保播放按钮状态同步
    const pbtn = document.getElementById('pbtn');
    pbtn.innerText = "⏸";
};
    });
})();
