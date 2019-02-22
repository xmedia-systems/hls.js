import { LoaderCallbacks, LoaderContext, LoaderStats } from '../types/loader';

/**
 * Fetch based loader
 * timeout / abort / onprogress not supported for now
 * timeout / abort : some ideas here : https://github.com/whatwg/fetch/issues/20#issuecomment-196113354
 * but still it is not bullet proof as it fails to avoid data waste....
*/

const { Request, Headers, fetch, performance } = window as any;

class FetchLoader {
  private config: any;
  private fetchSetup: Function;
  private request!: Request;
  private response!: Response;
  public stats: LoaderStats;

  constructor (config) {
    this.config = config;
    this.fetchSetup = config.fetchSetup || getRequest;
    this.stats = {
      tfirst: 0,
      trequest: 0,
      tload: 0,
      loaded: 0,
      total: 0,
      retry: 0,
      aborted: false
    };
  }

  destroy (): void {
    this.abort();
  }

  abort (): void {
    this.stats.aborted = true;
  }

  load (context: LoaderContext, config: any, callbacks: LoaderCallbacks): void {
    const stats = this.stats;
    stats.trequest = window.performance.now();
    stats.retry = 0;
    stats.tfirst = 0;
    stats.loaded = 0;

    const initParams = getRequestParameters(context);

    this.request = this.fetchSetup(context, initParams);

    fetch(this.request, initParams).then((response: Response): Promise<string | ArrayBuffer> => {
      this.response = response;
      if (stats.aborted) {
        return Promise.resolve('');
      }
      if (!response.ok) {
        const { status, statusText } = response;
        throw new FetchError(statusText || 'fetch, bad network response', status, response);
      }
      stats.tfirst = Math.max(window.performance.now(), stats.trequest);

      if (context.responseType === 'arraybuffer') {
        return response.arrayBuffer();
      }
      return response.text();
    }).then((responseData: string | ArrayBuffer) => {
      if (stats.aborted || !responseData) {
        return;
      }
      stats.tload = Math.max(stats.tfirst, performance.now());
      stats.loaded = stats.total = (typeof responseData === 'string') ? responseData.length : responseData.byteLength;

      const onProgress = callbacks.onProgress;
      if (onProgress) {
        onProgress(stats, context, responseData, this.response);
      }

      const response = { url: this.response.url, data: responseData };
      callbacks.onSuccess(response, stats, context, this.response);
    }).catch((error) => {
      if (stats.aborted) {
        return;
      }
      callbacks.onError({ code: error.code, text: error.message }, context, error.details);
    });
  }
}

function getRequestParameters (context: LoaderContext): any {
  const initParams: any = {
    method: 'GET',
    mode: 'cors',
    credentials: 'same-origin'
  };

  if (context.rangeEnd) {
    initParams.headers = new Headers({
      Range: 'bytes=' + context.rangeStart + '-' + String(context.rangeEnd - 1)
    });
  }

  return initParams;
}

function getRequest (context: LoaderContext, initParams: any): Request {
  return new Request(context.url, initParams);
}

class FetchError extends Error {
  public code: number;
  public details: any;
  constructor (message: string, code: number, details: any) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export default FetchLoader;
