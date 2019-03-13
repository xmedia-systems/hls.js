import { ErrorTypes, ErrorDetails } from '../errors';
import { logger } from '../utils/logger';
import Fragment from './fragment';
import {
    Loader,
    LoaderStats,
    LoaderConfiguration,
    FragmentLoaderContext,
    LoaderContext,
    LoaderCallbacks
} from '../types/loader';

export default class FragmentLoader {
  private config: any;
  private loader: Loader<FragmentLoaderContext> | null = null;
  constructor (config) {
    this.config = config;
  }

  load (frag: Fragment, onProgress?: FragmentLoadProgressCallback): Promise<FragLoadSuccessResult | LoadError> {
    if (!frag.url) {
      return Promise.reject(new LoadError(null, 'Fragment does not have a url'));
    }

    const config = this.config;
    const FragmentILoader = config.fLoader;
    const DefaultILoader = config.loader;

    let loader = this.loader;
    if (loader) {
      logger.warn(`Aborting loader for previous ${frag.type} fragment`);
      loader.abort();
    }

    loader = this.loader = frag.loader =
      config.fLoader ? new FragmentILoader(config) : new DefaultILoader(config);

    const loaderContext: FragmentLoaderContext = {
      frag,
      responseType: 'arraybuffer',
      url: frag.url,
      rangeStart: 0,
      rangeEnd: 0
    };

    const start = frag.byteRangeStartOffset;
    const end = frag.byteRangeEndOffset;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      loaderContext.rangeStart = start;
      loaderContext.rangeEnd = end;
    }

    const loaderConfig: LoaderConfiguration = {
      timeout: config.fragLoadingTimeOut,
      maxRetry: 0,
      retryDelay: 0,
      maxRetryDelay: config.fragLoadingMaxRetryTimeout
    };

    return new Promise((resolve, reject) => {
      if (!loader) {
        reject(new LoadError(null, 'Loader was destroyed after fragment request'));
        return;
      }
      const callbacks: LoaderCallbacks<FragmentLoaderContext> = {
          onSuccess: (response, stats, context, networkDetails) => {
              this._resetLoader(frag);
              frag.stats = stats;
              resolve({
                  payload: response.data as ArrayBuffer,
                  stats,
                  networkDetails
              });
          },
          onError: (response, context, networkDetails) => {
              this._resetLoader(frag);
              reject(new LoadError({
                  type: ErrorTypes.NETWORK_ERROR,
                  details: ErrorDetails.FRAG_LOAD_ERROR,
                  fatal: false,
                  frag,
                  response,
                  networkDetails
              }));
          },
          onAbort: (stats, context, networkDetails) => {
              this._resetLoader(frag);
              reject(new LoadError({
                  type: ErrorTypes.NETWORK_ERROR,
                  details: ErrorDetails.INTERNAL_ABORTED,
                  fatal: false,
                  frag,
                  networkDetails
              }));
          },
          onTimeout: (response, context, networkDetails) => {
              this._resetLoader(frag);
              reject(new LoadError({
                  type: ErrorTypes.NETWORK_ERROR,
                  details: ErrorDetails.FRAG_LOAD_TIMEOUT,
                  fatal: false,
                  frag,
                  networkDetails
              }));
          },
          onProgress: (stats, context, data, networkDetails) => {
            if (onProgress) {
              onProgress(stats, context, data as ArrayBuffer, networkDetails);
            }
          }
      };
      loader.load(loaderContext, loaderConfig, callbacks);
    });
  }

  _resetLoader (frag: Fragment) {
    frag.loader = null;
    this.loader = null;
  }
}

export class LoadError extends Error {
  private data: FragLoadFailResult | null;
  constructor (data, ...params) {
    super(...params);
    this.data = data;
  }
}

export interface FragLoadSuccessResult {
  payload: ArrayBuffer
  stats: LoaderStats
  networkDetails: XMLHttpRequest | null
}

export interface FragLoadFailResult {
  type: string
  details: string
  fatal: boolean
  frag: Fragment
  networkDetails: XMLHttpRequest
}

export type FragmentLoadProgressCallback = (stats: LoaderStats, context: LoaderContext, data: ArrayBuffer, networkDetails?: XMLHttpRequest) => void;
