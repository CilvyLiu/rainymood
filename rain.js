/**
 * Nova's Rain Engine - Real Texture Edition
 * 修复了“方块”问题，使用 alpha 遮罩渲染
 */

class RainRenderer {
    constructor(canvas, background, dropAlpha, dropColor) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.background = background;
        this.dropAlpha = dropAlpha;
        this.dropColor = dropColor;
        this.drops = [];
        this.options = { 
            rainChance: 0.2, 
            maxDrops: 100,
            scale: 0.5 // 控制水滴大小，可以根据需要调整
        };
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
            // 随机大小，但保持比例
            size: Math.random() * 30 + 20, 
            v: Math.random() * 4 + 3, // 下落速度
            opacity: Math.random() * 0.5 + 0.3
        });
    }

    drawRealDrop(d) {
        const ctx = this.ctx;
        const width = d.size;
        const height = d.size * 1.5; // 水滴通常比宽度长一点

        ctx.save();
        
        // --- 核心修复逻辑 ---
        
        // 1. 设置透明度
        ctx.globalAlpha = d.opacity;
        
        // 2. 先画出 Alpha 通道（形状）
        // 这一步决定了水滴不是“方块”而是你图片里的形状
        ctx.drawImage(this.dropAlpha, d.x, d.y, width, height);

        // 3. 关键步骤：使用 source-atop 模式叠加颜色
        // 这意味着“只在刚才画过的地方”叠加上色，多余的方块边缘会被剪掉
        ctx.globalCompositeOperation = 'source-atop';
        ctx.drawImage(this.dropColor, d.x, d.y, width, height);
        
        ctx.restore();
        
        // 重置绘图模式，防止影响后续渲染
        ctx.globalCompositeOperation = 'source-over';
    }

    animate() {
        // 清理并绘制背景
        this.ctx.globalAlpha = 1.0;
        if (this.background) {
            this.ctx.drawImage(this.background, 0, 0, this.canvas.width, this.canvas.height);
        }

        // 生成新水滴
        if (Math.random() < this.options.rainChance) this.createDrop();
        
        // 更新位置并绘制
        for (let i = this.drops.length - 1; i >= 0; i--) {
            const d = this.drops[i];
            d.y += d.v;
            
            // 绘制
            this.drawRealDrop(d);

            // 越界移除
            if (d.y > this.canvas.height + 100) {
                this.drops.splice(i, 1);
            }
        }

        requestAnimationFrame(() => this.animate());
    }
}

// 确保图片资源加载
window.addEventListener('load', () => {
    const container = document.getElementById('container');
    if (!container) return;

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
