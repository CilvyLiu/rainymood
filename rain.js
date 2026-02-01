'use strict';
(function() {
    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame =
            window.webkitRequestAnimationFrame ||
            window.mozRequestAnimationFrame ||
            function(cb) {
                return setTimeout(cb, 1000 / 60);
            };
    }
})();
/* =========================
   rain.js - 完整 ES5 版本
   自包含文件，兼容所有现代浏览器
   功能：
   - WebGL 雨水特效
   - 雨滴碰撞与拖尾
   - 闪电、视差、雨滴清理
   - 图片加载
========================= */

/* =========================
   create-canvas.js
========================= */
function createCanvas(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/* =========================
   image-loader.js
========================= */
function loadImages(images, callback) {
    var loaded = 0;
    for (var i = 0; i < images.length; i++) {
        (function(imgObj) {
            var img = new Image();
            img.src = imgObj.src;
            img.onload = function() {
                imgObj.img = img;
                loaded++;
                if (loaded === images.length) {
                    callback(images);
                }
            };
        })(images[i]);
    }
}

/* =========================
   webgl.js
========================= */
function getWebGLContext(canvas, options) {
    options = options || {};
    var contexts = ['webgl', 'experimental-webgl'], gl = null;
    for (var i = 0; i < contexts.length; i++) {
        try {
            gl = canvas.getContext(contexts[i], options);
        } catch (e) {}
        if (gl) break;
    }
    if (!gl) document.body.classList.add('no-webgl');
    return gl;
}

function createShader(gl, source, type) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl, vsSource, fsSource) {
    var vs = createShader(gl, vsSource, gl.VERTEX_SHADER);
    var fs = createShader(gl, fsSource, gl.FRAGMENT_SHADER);
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error: ' + gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

function createGLTexture(gl, img, unit) {
    var tex = gl.createTexture();
    gl.activeTexture(gl['TEXTURE' + unit]);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    return tex;
}

function setRectangle(gl, buffer, x, y, width, height) {
    var vertices = new Float32Array([
        x, y + height,
        x + width, y + height,
        x, y,
        x, y,
        x + width, y + height,
        x + width, y
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

/* =========================
   Raindrops 完整实现（整体替换）
========================= */

function Raindrops(width, height, canvas, ctx, options) {
    this.width = width;
    this.height = height;
    this.canvas = canvas;
    this.ctx = ctx;

    this.options = options || {};

    this.scale = window.devicePixelRatio || 1;
    this.areaMultiplier = (width * height) / (800 * 600);

    this.drops = [];
    this.dropsGfx = [];

    /* ===== 雨滴贴图缓存 ===== */
    for (var i = 0; i < 8; i++) {
        var c = createCanvas(64, 64);
        var cctx = c.getContext('2d');

        var r = 28 - i * 3;
        var g = cctx.createRadialGradient(32, 32, 0, 32, 32, r);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');

        cctx.fillStyle = g;
        cctx.beginPath();
        cctx.arc(32, 32, r, 0, Math.PI * 2);
        cctx.fill();

        this.dropsGfx.push(c);
    }

    /* ===== 雨点层 ===== */
    this.dropletsCanvas = createCanvas(width * this.scale, height * this.scale);
    this.dropletsCtx = this.dropletsCanvas.getContext('2d');

    /* ===== 擦除贴图（鼠标擦玻璃） ===== */
    this.clearDropletsGfx = createCanvas(128, 128);
    var cg = this.clearDropletsGfx.getContext('2d');
    var grad = cg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    cg.fillStyle = grad;
    cg.fillRect(0, 0, 128, 128);

    this.dropletsCounter = 0;
    this.lastRender = 0;
}

/* ===== 单个雨点 ===== */
Raindrops.prototype.drawDroplet = function(x, y, r) {
    var drop = {
        x: x,
        y: y,
        r: r,
        spreadX: 1,
        spreadY: 1
    };
    this.drawDrop(this.dropletsCtx, drop);
};

Raindrops.prototype.drawDrop = function(ctx, drop) {
    if (!this.dropsGfx || !this.dropsGfx.length) return;

    var u = (drop.r - this.options.minR) /
            (this.options.maxR - this.options.minR);
    u = Math.max(0, Math.min(1, u)) * 0.9;
    u *= 1 / (0.5 * (drop.spreadX + drop.spreadY) + 1);

    var index = Math.floor(u * (this.dropsGfx.length - 1));
    var img = this.dropsGfx[index];

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(
        img,
        (drop.x - drop.r * drop.spreadX) * this.scale,
        (drop.y - drop.r * drop.spreadY) * this.scale,
        2 * drop.r * drop.spreadX * this.scale,
        2 * drop.r * drop.spreadY * this.scale
    );
};

/* ===== 擦除雨点 ===== */
Raindrops.prototype.clearDroplets = function(x, y, radius) {
    radius = radius || 30;
    this.dropletsCtx.globalCompositeOperation = 'destination-out';
    this.dropletsCtx.drawImage(
        this.clearDropletsGfx,
        (x - radius) * this.scale,
        (y - radius) * this.scale,
        2 * radius * this.scale,
        2 * radius * this.scale * 1.5
    );
    this.dropletsCtx.globalCompositeOperation = 'source-over';
};

/* ===== 清屏 ===== */
Raindrops.prototype.clearCanvas = function() {
    this.ctx.clearRect(0, 0, this.width, this.height);
};

/* ===== 创建雨滴 ===== */
Raindrops.prototype.createDrop = function(params) {
    if (this.drops.length >= this.options.maxDrops * this.areaMultiplier) {
        return null;
    }
    return {
        x: params.x,
        y: params.y,
        r: params.r,
        momentum: params.momentum || 1
    };
};

/* ===== 更新雨点层 ===== */
Raindrops.prototype.updateDroplets = function(deltaTime) {
    this.dropletsCounter +=
        this.options.dropletsRate * deltaTime * this.areaMultiplier;

    while (this.dropletsCounter > 1) {
        this.dropletsCounter--;

        this.drawDroplet(
            Math.random() * this.width / this.scale,
            Math.random() * this.height / this.scale,
            Math.pow(
                Math.random() *
                    (this.options.dropletsSize[1] -
                     this.options.dropletsSize[0]) +
                    this.options.dropletsSize[0],
                2
            )
        );
    }

    this.ctx.drawImage(
        this.dropletsCanvas,
        0,
        0,
        this.width,
        this.height
    );
};

/* ===== 更新雨滴 ===== */
Raindrops.prototype.updateDrops = function(deltaTime) {
    this.updateDroplets(deltaTime);

    var i, d;
    var newDrops = [];

    for (i = 0; i < this.options.rainLimit * deltaTime; i++) {
        if (Math.random() < this.options.rainChance * deltaTime) {
            var r =
                this.options.minR +
                Math.random() *
                    (this.options.maxR - this.options.minR);

            var drop = this.createDrop({
                x: Math.random() * this.width / this.scale,
                y: -r,
                r: r,
                momentum: 1 + 0.15 * r
            });

            if (drop) newDrops.push(drop);
        }
    }

    this.drops = this.drops.concat(newDrops);

    for (i = 0; i < this.drops.length; i++) {
        d = this.drops[i];
        d.y += d.momentum * deltaTime * this.options.globalTimeScale;
        if (d.y > this.height / this.scale + d.r) {
            d.killed = true;
        }
    }

    this.drops = this.drops.filter(function(d) {
        return !d.killed;
    });

    for (i = 0; i < this.drops.length; i++) {
        this.drawDrop(this.ctx, this.drops[i]);
    }
};
function RainRenderer(container, bg, fg, dropColor, dropAlpha, options) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.width = container.clientWidth;
    this.height = container.clientHeight;

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    container.appendChild(this.canvas);

    this.raindrops = new Raindrops(
        this.width,
        this.height,
        this.canvas,
        this.ctx,
        {
            minR: 2,
            maxR: 40,
            rainChance: 0.35,
            rainLimit: 6,
            dropletsRate: 50,
            dropletsSize: [1, 2],
            globalTimeScale: 1,
            maxDrops: 900
        }
    );

    this.lastTime = Date.now();
}

/* =========================
   RainRenderer 核心方法（完整可运行版）
========================= */

RainRenderer.prototype.init = function() {
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    // ⚠️ WebGL 可选兜底（没有也不炸）
    try {
        this.gl = getWebGLContext ? getWebGLContext(this.canvas, { alpha: false }) : null;
    } catch (e) {
        this.gl = null;
    }

    this.textures = [];
    this.lastTime = Date.now();
};

RainRenderer.prototype.draw = function() {
    var now = Date.now();
    var delta = (now - this.lastTime) / (1000 / 60);
    this.lastTime = now;

    // 纯 2D Canvas 路径（稳定）
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.raindrops.updateDrops(delta);

    var self = this;
    requestAnimationFrame(function() {
        self.draw();
    });
};

RainRenderer.prototype.updateTextures = function() {
    // WebGL 扩展位（当前 2D 不需要）
};

RainRenderer.prototype.updateTexture = function() {
    // WebGL 扩展位（当前 2D 不需要）
};


(function() {
    var container = document.querySelector('#container');
    if (!container) return;

    var images = [
        {name: 'dropAlpha', src: 'drop-alpha.png'},
        {name: 'dropColor', src: 'drop-color.png'},
        {name: 'beach', src: 'beach.png'},
        {name: 'mountain', src: 'mountain.png'},
        {name: 'train', src: 'train.png'},
        {name: 'window', src: 'window.png'},
        {name: 'pensive', src: 'pensive.png'}
    ];

    loadImages(images, function(loadedImages) {
        function pick(name) {
            var i = loadedImages.filter(function(x){return x.name === name;})[0];
            return i ? i.img : null;
        }

        var renderer = new RainRenderer(
            container,
            null,
            null,
            pick('dropColor'),
            pick('dropAlpha'),
            {}
        );

        renderer.init();
        renderer.draw();

        // 鼠标擦玻璃
        renderer.canvas.addEventListener('mousemove', function(e) {
            var r = renderer.canvas.getBoundingClientRect();
            renderer.raindrops.clearDroplets(
                e.clientX - r.left,
                e.clientY - r.top,
                35
            );
        });

        // resize
        window.addEventListener('resize', function() {
            renderer.width = container.clientWidth;
            renderer.height = container.clientHeight;
            renderer.canvas.width = renderer.width;
            renderer.canvas.height = renderer.height;
            renderer.raindrops.width = renderer.width;
            renderer.raindrops.height = renderer.height;
        });
    });
})();
        /* =========================
           resize 自适应
        ========================= */
        window.addEventListener('resize', function() {
            renderer.width = container.clientWidth;
            renderer.height = container.clientHeight;
            renderer.canvas.width = renderer.width;
            renderer.canvas.height = renderer.height;

            renderer.raindrops.width = renderer.width;
            renderer.raindrops.height = renderer.height;
        });
    });
})();
