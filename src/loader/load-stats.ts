import { LoaderStats } from '../types/loader';

export default class LoadStats implements LoaderStats {
  aborted: boolean = false;
  loaded: number = 0;
  retry: number = 0;
  tbuffered: number = 0;
  tfirst: number = 0;
  tload: number = 0;
  total: number = 0;
  tparsed: number = 0;
  trequest: number = 0;
  lastParseStart: number | null = null;
  parseCumulative: number = 0;
  // lastBufferStart: number | null = null;
  // bufferingCumulative: number = 0;
}