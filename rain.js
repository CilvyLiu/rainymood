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
        this.width = width; this.height = height; this.scale = scale;
        this.dropAlpha = dropAlpha; this.dropColor = dropColor;
        this.drops = [];
        this.canvas = createCanvas(width * scale, height * scale);
        this.ctx = this.canvas.getContext('2d');
        // 稍微调高 rainChance，确保能看到雨滴
        this.options = { minR: 20, maxR: 50, rainChance: 0.75, collisionRadius: 0.45 };
    }

    Raindrops.prototype.update = function(delta) {
        if (Math.random() < this.options.rainChance * delta) {
            this.drops.push({
                x: Math.random() * this.width,
                y: -100,
                r: Math.random() * (this.options.maxR - this.options.minR) + this.options.minR,
                v: Math.random() * 6 + 4
            });
        }
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (var i = this.drops.length - 1; i >= 0; i--) {
            var d = this.drops[i];
            d.y += d.v * delta;
            var size = d.r * 2 * this.scale;
            
            this.ctx.globalAlpha = 1.0;
            this.ctx.globalCompositeOperation = 'source-over';
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
        this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
        this.scale = window.devicePixelRatio || 1;
        this.raindrops = new Raindrops(container.clientWidth, container.clientHeight, this.scale, resources.dropAlpha, resources.dropColor);
        this.init();
    }

    RainRenderer.prototype.init = function() {
        var gl = this.gl;
        var vs = 'attribute vec2 p;varying vec2 v;void main(){gl_Position=vec4(p,0,1);v=p*0.5+0.5;v.y=1.0-v.y;}';
        // 关键强化：r.b * 0.65 显著提升了雨滴在暗色（冥想盆）背景下的反光感
        var fs = 'precision mediump float;varying vec2 v;uniform sampler2D b,w;void main(){vec4 r=texture2D(w,v);vec2 o=(r.rg-0.5)*0.35;if(r.a>0.005){gl_FragColor=texture2D(b,v+o)+r.b*0.65;}else{gl_FragColor=texture2D(b,v);}}';
        
        var prog = gl.createProgram();
        [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach(function(type, i){
            var sh = gl.createShader(type); gl.shaderSource(sh, i===0?vs:fs); gl.compileShader(sh); gl.attachShader(prog, sh);
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
            img.onload = function() { renderer.updateBackground(img); };
            img.src = sceneUrl;

            // 双音轨逻辑核心：
            var a_scene = document.getElementById('audio_scene');
            var a_bg = document.getElementById('audio_bg');
            
            // 确保背景雨声 0.m4a 永不停歇
            if(a_bg && a_bg.paused) a_bg.play().catch(e => {});

            if (a_scene) {
                // 如果是切换回冥想盆，则停掉场景音
                if(sceneUrl === 'pensive.png') {
                    a_scene.pause();
                } else {
                    // train.png -> train.m4a
                    var audioUrl = sceneUrl.split('.')[0] + '.m4a';
                    a_scene.src = audioUrl;
                    a_scene.play().catch(e => console.log("等待点击页面激活声音"));
                }
            }
        };
    });
})();
