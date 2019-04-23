export type SourceBufferName = 'video' | 'audio';

export interface Segment {
  type: SourceBufferName;
  data: ArrayBuffer;
  parent: string;
  content: string;
}
