import { LoaderCallbacks, LoaderContext, Loader, LoaderStats, LoaderConfiguration } from '../types/loader';

const { fetch, AbortController, ReadableStream, Request, Headers, performance } = window as any;

export function fetchSupported () {
    if (fetch && AbortController && ReadableStream && Request) {
        try {
            new ReadableStream({}); // eslint-disable-line no-new
            return true;
        } catch (e) { /* noop */ }
    }
    return false;
}

class FetchLoader implements Loader<LoaderContext> {
  private config!: LoaderConfiguration;
  private fetchSetup: Function;
  private requestTimeout?: number;
  private request!: Request;
  private response!: Response;
  private controller: AbortController;
  public context!: LoaderContext;
  public stats: LoaderStats;

  constructor (config /* HlsConfig */) {
    this.fetchSetup = config.fetchSetup || getRequest;
    this.controller = new AbortController();
    this.stats = {
      tfirst: 0,
      trequest: 0,
      tload: 0,
      loaded: 0,
      tparsed: 0,
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
    this.controller.abort();
  }

  load (context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
    this.context = context;
    this.config = config;

    const stats = this.stats;
    stats.trequest = window.performance.now();

    const initParams = getRequestParameters(context, this.controller.signal);

    this.request = this.fetchSetup(context, initParams);

    this.requestTimeout = window.setTimeout(() => {
      this.abort();
      callbacks.onTimeout(stats, context);
    }, config.timeout);

    fetch(this.request, initParams).then((response: Response): Promise<string | ArrayBuffer> => {
      this.response = response;

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
      clearTimeout(this.requestTimeout);
      stats.tload = Math.max(stats.tfirst, performance.now());
      stats.loaded = stats.total = (typeof responseData === 'string') ? responseData.length : responseData.byteLength;

      const onProgress = callbacks.onProgress;
      if (onProgress) {
        onProgress(stats, context, responseData, this.response);
      }

      const response = { url: this.response.url, data: responseData };
      callbacks.onSuccess(response, stats, context, this.response);
    }).catch((error) => {
      clearTimeout(this.requestTimeout);
      if (stats.aborted) {
        return;
      }
      callbacks.onError({ code: error.code, text: error.message }, context, error.details);
    });
  }
}

function getRequestParameters (context: LoaderContext, signal): any {
  const initParams: any = {
    method: 'GET',
    mode: 'cors',
    credentials: 'same-origin',
    signal,
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
