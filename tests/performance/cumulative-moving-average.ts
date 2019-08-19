export default class CMA {
  public avg: number = 0;
  private sampleCount: number = 0;

  update (value: number): void {
    this.avg = ((value + (this.sampleCount * this.avg)) / (this.sampleCount + 1));
    this.sampleCount++;
  }
}