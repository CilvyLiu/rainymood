class RainRenderer {
    constructor(canvas, background, dropAlpha, dropColor) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.background = background;
        this.dropAlpha = dropAlpha;
        this.dropColor = dropColor;
        this.drops = [];
        this.options = { rainChance: 0.2, maxDrops: 120 };
        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.animate();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    updateBackground(src) {
        const img = new Image();
        img.src = src;
        img.onload = () => { this.background = img; };
    }

    createDrop() {
        if (this.drops.length >= this.options.maxDrops) return;
        this.drops.push({
            x: Math.random() * this.canvas.width,
            y: Math.random() * -this.canvas.height,
            r: Math.random() * 20 + 15, // 对应图片大小
            v: Math.random() * 2 + 2,
            opacity: Math.random() * 0.4 + 0.2
        });
    }

    // 核心渲染：使用位图遮罩代替绘制圆圈
    drawRealDrop(d) {
        this.ctx.save();
        this.ctx.globalAlpha = d.opacity;
        
        // 1. 绘制真实雨滴形状 (使用你的 drop-alpha.png)
        this.ctx.drawImage(this.dropAlpha, d.x, d.y, d.r, d.r * 1.5);
        
        // 2. 模拟折射光泽 (使用你的 drop-color.png)
        this.ctx.globalCompositeOperation = 'source-atop';
        this.ctx.globalAlpha = 0.3;
        this.ctx.drawImage(this.dropColor, d.x, d.y, d.r, d.r * 1.5);
        
        this.ctx.restore();
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 绘制底层场景背景
        this.ctx.globalAlpha = 1.0;
        this.ctx.drawImage(this.background, 0, 0, this.canvas.width, this.canvas.height);

        // 生成与更新
        if (Math.random() < this.options.rainChance) this.createDrop();
        
        this.drops.forEach((d, i) => {
            d.y += d.v;
            if (d.y > this.canvas.height + 50) this.drops.splice(i, 1);
            this.drawRealDrop(d);
        });

        requestAnimationFrame(() => this.animate());
    }
}

// 启动预加载
window.addEventListener('load', () => {
    const container = document.getElementById('container');
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    const sources = {
        bg: 'pensive.png',
        alpha: 'drop-alpha.png',
        color: 'drop-color.png'
    };

    let images = {}, loaded = 0;
    for (let key in sources) {
        images[key] = new Image();
        images[key].src = sources[key];
        images[key].onload = () => {
            if (++loaded === 3) {
                window.rainEngine = new RainRenderer(canvas, images.bg, images.alpha, images.color);
            }
        };
    }
});
