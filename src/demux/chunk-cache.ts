export default class ChunkCache {
  private chunks: Array<Uint8Array> = [];
  public dataLength: number = 0;

  push (chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.dataLength += chunk.length;
  }

  flush (): Uint8Array | null {
    const { chunks, dataLength } = this;
    let result;
    if (!chunks.length) {
      return null
    } else if (chunks.length === 1) {
      result = chunks[0];
    } else {
      result = concatUint8Arrays(chunks, dataLength);
    }
    this.reset();
    return result;
  }

  reset () {
    this.chunks = [];
    this.dataLength = 0;
  }
}

function concatUint8Arrays (chunks: Array<Uint8Array>, dataLength: number) : Uint8Array {
  const result = new Uint8Array(dataLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}