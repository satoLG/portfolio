import { MathUtils } from "three";

export class Random
{
    seed = 0;
    state = 0;

    constructor(seed?: number)
    {
        if (seed)
        {
            this.seed = seed;
            this.state = this.Generate(seed);
        }
        else
        {
            this.seed = Math.random();
            this.state = this.Generate(this.seed);
        }
    }

    Next(): number
    {
        this.state = this.Generate(this.state);
        return this.state;
    }

    Generate(x: number): number
    {
        const n = Math.sin(x * 12.9898) * 43758.5453;
        return n - Math.floor(n);
    }
    
    Generate2D(x: number, y: number): number
    {
        x += this.seed;
        y += this.seed;

        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return n - Math.floor(n);
    }
    
    Perlin(x: number, y: number): number
    {
        function CubicInterpolation(a: number, b: number, t: number): number
        {
            t = t * t * t * (t * (t * 6 - 15) + 10);
            return (1 - t) * a + t * b;
        }
    
        const leftX = Math.floor(x);
        const topY = Math.floor(y);
        const rightX = leftX + 1;
        const bottomY = topY + 1;
        const leftOffset = x - leftX;
        const topOffset = y - topY;
        const rightOffset = x - rightX;
        const bottomOffset = y - bottomY;
    
        const topLeftGridValue = this.Generate2D(leftX, topY) * Math.PI * 2;
        const topRightGridValue = this.Generate2D(rightX, topY) * Math.PI * 2;
        const bottomLeftGridValue = this.Generate2D(leftX, bottomY) * Math.PI * 2;
        const bottomRightGridValue = this.Generate2D(rightX, bottomY) * Math.PI * 2;
    
        const topLeftNoiseValue = leftOffset * Math.cos(topLeftGridValue) + topOffset * Math.sin(topLeftGridValue);
        const topRightNoiseValue = rightOffset * Math.cos(topRightGridValue) + topOffset * Math.sin(topRightGridValue);
        const bottomLeftNoiseValue = leftOffset * Math.cos(bottomLeftGridValue) + bottomOffset * Math.sin(bottomLeftGridValue);
        const bottomRightNoiseValue = rightOffset * Math.cos(bottomRightGridValue) + bottomOffset * Math.sin(bottomRightGridValue);
        
        const topNoiseValue = CubicInterpolation(topLeftNoiseValue, topRightNoiseValue, leftOffset);
        const bottomNoiseValue = CubicInterpolation(bottomLeftNoiseValue, bottomRightNoiseValue, leftOffset);
        return MathUtils.clamp(CubicInterpolation(topNoiseValue, bottomNoiseValue, topOffset), -0.7, 0.7) / 0.7;
    }
    
    Ridge(x: number, y: number, p: number): number
    {
        return Math.pow(Math.abs(this.Perlin(x, y)), p);
    }
}
