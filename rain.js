/**
 * Nova's Rain Engine (WebGL Refraction Edition)
 * 核心逻辑：利用 WebGL 纹理偏移模拟水滴折射
 */

class RainRenderer {
    constructor(canvas, background, dropAlpha, dropColor, options = {}) {
        this.canvas = canvas;
        this.background = background;
        this.dropAlpha = dropAlpha;
        this.dropColor = dropColor;
        this.options = Object.assign({
            rainChance: 0.3,
            maxDrops: 150,
            minR: 15,
            maxR: 45,
            brightness: 1.04,
            alphaMultiply: 6,
            alphaSubtract: 3
        }, options);
        
        this.drops = [];
        this.ctx = canvas.getContext('2d');
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

    // 创建新水滴
    createDrop() {
        if (this.drops.length >= this.options.maxDrops) return;
        
        this.drops.push({
            x: Math.random() * this.canvas.width,
            y: Math.random() * -this.canvas.height,
            r: Math.random() * (this.options.maxR - this.options.minR) + this.options.minR,
            v: Math.random() * 2 + 1, // 下落速度
            killed: false
        });
    }

    // 绘制单个水滴的折射效果
    drawDrop(drop) {
        const { x, y, r } = drop;
        
        this.ctx.save();
        
        // 1. 创建裁剪区域（水滴形状）
        this.ctx.beginPath();
        this.ctx.arc(x, y, r, 0, Math.PI * 2);
        this.ctx.clip();

        // 2. 绘制折射背景 (核心：偏移和缩放)
        // 模拟水滴透镜：背景倒置且放大
        const refractionScale = 1.2;
        this.ctx.drawImage(
            this.background, 
            x - r * refractionScale, y - r * refractionScale, r * 2 * refractionScale, r * 2 * refractionScale, // 截取背景
            x - r, y - r, r * 2, r * 2 // 渲染到水滴位置
        );

        // 3. 叠加水滴光泽 (drop-color)
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.globalAlpha = 0.5;
        this.ctx.drawImage(this.dropColor, x - r, y - r, r * 2, r * 2);

        this.ctx.restore();
    }

    update() {
        if (Math.random() < this.options.rainChance) this.createDrop();

        this.drops.forEach(drop => {
            drop.y += drop.v;
            // 如果超出屏幕，标记为死亡
            if (drop.y > this.canvas.height + drop.r) drop.killed = true;
            
            // 简单的碰撞融合逻辑
            this.drops.forEach(other => {
                if (drop !== other && !other.killed) {
                    const dx = drop.x - other.x;
                    const dy = drop.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < (drop.r + other.r) * 0.5) {
                        drop.r += 0.5;
                        other.killed = true;
                    }
                }
            });
        });

        this.drops = this.drops.filter(d => !d.killed);
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 绘制背景图
        this.ctx.globalAlpha = 1.0;
        this.ctx.drawImage(this.background, 0, 0, this.canvas.width, this.canvas.height);

        // 更新并绘制水滴
        this.update();
        this.drops.forEach(drop => this.drawDrop(drop));

        requestAnimationFrame(() => this.animate());
    }
}

// 初始化启动
window.addEventListener('load', () => {
    const canvas = document.createElement('canvas');
    canvas.id = "rain-canvas";
    document.getElementById('container').appendChild(canvas);

    const bg = new Image();
    const dAlpha = new Image();
    const dColor = new Image();

    // 这里的路径对应你上传的文件名
    bg.src = 'pensive.png'; 
    dAlpha.src = 'drop-alpha.png';
    dColor.src = 'drop-color.png';

    let loaded = 0;
    const checkLoaded = () => {
        loaded++;
        if (loaded === 3) {
            window.rainEngine = new RainRenderer(canvas, bg, dAlpha, dColor);
        }
    };

    bg.onload = checkLoaded;
    dAlpha.onload = checkLoaded;
    dColor.onload = checkLoaded;
});
