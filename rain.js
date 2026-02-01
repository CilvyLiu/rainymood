'use strict';

(function() {
    function createCanvas(w, h) {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    function loadImages(images, callback) {
        var loaded = 0, dict = {};
        images.forEach(function(item) {
            var img = new Image();
            img.onload = function() {
                dict[item.name] = img;
                if (++loaded === images.length) callback(dict);
            };
            img.onerror = function() {
                console.error("Nova, 资源加载失败:", item.src);
                if (++loaded === images.length) callback(dict);
            };
            img.src = item.src;
        });
    }

    function Raindrops(width, height, scale, dropAlpha, dropColor) {
        this.width = width;
        this.height = height;
        this.scale = scale;
        this.dropAlpha = dropAlpha;
        this.dropColor = dropColor;
        this.drops = [];
        // 确保宽高不为0
        var cw = (width || window.innerWidth) * scale;
        var ch = (height || window.innerHeight) * scale;
        this.canvas = createCanvas(cw, ch);
        this.ctx = this.canvas.getContext('2d');
        this.options = {
            minR: 15, maxR: 45, rainChance: 0.5, // 稍微调高概率便于观察
            collisionRadius: 0.45
        };
    }

    Raindrops.prototype.update = function(delta) {
        if (Math.random() < this.options.rainChance * delta) {
            this.drops.push({
                x: Math.random() * this.width,
                y: -100,
                r: Math.random() * (this.options.maxR - this.options.minR) + this.options.minR,
                v: Math.random() * 5 + 3
            });
        }

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (var i = this.drops.length - 1; i >= 0; i--) {
            var d = this.drops[i];
            d.y += d.v * delta;
            var size = d.r * 2 * this.scale;
            
            this.ctx.globalAlpha = 1.0;
            this.ctx.drawImage(this.dropAlpha, (d.x - d.r) * this.scale, (d.y - d.r) * this.scale, size, size);
            this.ctx.globalCompositeOperation = 'source-in';
            this.ctx.drawImage(this.dropColor, (d.x - d.r) * this.scale, (d.y - d.r) * this.scale, size, size);
            this.ctx.globalCompositeOperation = 'source-over';

            if (d.y > this.height + 100) this.drops.splice(i, 1);
        }
    };

    function RainRenderer(container, resources) {
        this.container = container;
        this.resources = resources;
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        container.appendChild(this.canvas);
        
        // 关键修复：显式设置 alpha 和 premultipliedAlpha
        this.gl = this.canvas.getContext('webgl', { 
            alpha: true, 
            premultipliedAlpha: false 
        }) || this.canvas.getContext('experimental-webgl');
        
        this.scale = window.devicePixelRatio || 1;
        this.raindrops = new Raindrops(container.clientWidth, container.clientHeight, this.scale, resources.dropAlpha, resources.dropColor);
        this.init();
    }

    RainRenderer.prototype.init = function() {
        var gl = this.gl;
        var vs = 'attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}';
        // 稍微调大 fs 中的偏移量 0.35 让折射更明显
        var fs = 'precision mediump float;varying vec2 v;uniform sampler2D b,w;void main(){vec4 r=texture2D(w,v);vec2 o=(r.rg-0.5)*0.35;if(r.a>0.01){gl_FragColor=texture2D(b,v+o)+r.b*0.15;}else{gl_FragColor=texture2D(b,v);}}';
        
        var prog = gl.createProgram();
        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach(function(type, i){
            var sh = gl.createShader(type); 
            gl.shaderSource(sh, i===0?vs:fs); 
            gl.compileShader(sh); 
            gl.attachShader(prog, sh);
        });
        gl.linkProgram(prog); gl.useProgram(prog);

        this.texBg = gl.createTexture();
        this.texWater = gl.createTexture();
        this.prog = prog;
        
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
        var p = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);

        this.resize();
        this.updateBackground(this.resources.pensive);
    };

    RainRenderer.prototype.resize = function() {
        this.width = this.container.clientWidth || window.innerWidth;
        this.height = this.container.clientHeight || window.innerHeight;
        this.canvas.width = this.width * this.scale;
        this.canvas.height = this.height * this.scale;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    };

    RainRenderer.prototype.updateBackground = function(img) {
        var gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    };

    RainRenderer.prototype.draw = function() {
        this.raindrops.update(1.0);
        var gl = this.gl;
        
        gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.raindrops.canvas);
        // 关键修复：每次更新纹理后重新设置参数
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texBg);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texWater);
        gl.uniform1i(gl.getUniformLocation(this.prog, "b"), 0);
        gl.uniform1i(gl.getUniformLocation(this.prog, "w"), 1);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(this.draw.bind(this));
    };

    loadImages([
        {name:'dropAlpha', src:'drop-alpha.png'},
        {name:'dropColor', src:'drop-color.png'},
        {name:'pensive', src:'pensive.png'}
    ], function(res) {
        var container = document.querySelector('#container');
        var renderer = new RainRenderer(container, res);
        window.rainEngine = renderer;
        renderer.draw();

        window.addEventListener('resize', function() { renderer.resize(); });

        window.changeScene = function(sceneUrl) {
            if (!sceneUrl || sceneUrl === "undefined") return;
            var img = new Image();
            img.onload = function() {
                if (window.rainEngine) window.rainEngine.updateBackground(img);
            };
            img.src = sceneUrl;

            var audio = document.getElementById('audio');
            if (audio) {
                var audioUrl = sceneUrl.split('.')[0] + '.m4a';
                audio.src = audioUrl;
                audio.play().catch(e => console.log("等待交互播放"));
            }
        };
    });
})();
