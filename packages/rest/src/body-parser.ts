// Copyright IBM Corp. 2017,2018. All Rights Reserved.
// Node module: @loopback/rest
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

import {OperationObject} from '@loopback/openapi-v3-types';
import * as debugModule from 'debug';
import * as HttpErrors from 'http-errors';
import {Request, Response, RequestBodyParserOptions} from './types';

import {
  json,
  urlencoded,
  text,
  OptionsJson,
  OptionsUrlencoded,
  OptionsText,
  Options,
} from 'body-parser';
import * as typeis from 'type-is';
import {inject} from '@loopback/context';
import {RestBindings} from './keys';

type HttpError = HttpErrors.HttpError;

const debug = debugModule('loopback:rest:body-parser');

// tslint:disable:no-any
export type RequestBody = {
  value: any | undefined;
  coercionRequired?: boolean;
};

/**
 * Express body parser function type
 */
type BodyParserWithCallback = (
  request: Request,
  response: Response,
  callback: (err: HttpError) => void,
) => void;

/**
 * Parse the body asynchronously
 * @param handle The express middleware handler
 * @param request Http request
 */
function parse(
  handle: BodyParserWithCallback,
  request: Request,
): Promise<void> {
  // A hack to fool TypeScript as we don't need `response`
  const response = ({} as any) as Response;
  return new Promise<void>((resolve, reject) => {
    handle(request, response, err => {
      if (err) {
        debug('Cannot parse request body %j', err);
        if (!err.statusCode || err.statusCode >= 500) {
          err.statusCode = 400;
        }
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// Default limit of the body length
const DEFAULT_LIMIT = '1mb';

type ParserOption<T extends 'json' | 'urlencoded' | 'text'> = T extends 'json'
  ? OptionsJson
  : T extends 'urlencoded'
    ? OptionsUrlencoded
    : T extends 'text' ? OptionsText : Options;

function getParserOptions<T extends 'json' | 'urlencoded' | 'text'>(
  type: T,
  options: RequestBodyParserOptions,
): ParserOption<T> {
  const opts: {[name: string]: any} = {};
  Object.assign(opts, options[type], options);
  for (const k of ['json', 'urlencoded', 'text']) {
    delete opts[k];
  }
  return opts as ParserOption<T>;
}

export class RequestBodyParser {
  private jsonParser: BodyParserWithCallback;
  private urlencodedParser: BodyParserWithCallback;
  private textParser: BodyParserWithCallback;

  constructor(
    @inject(RestBindings.REQUEST_BODY_PARSER_OPTIONS, {optional: true})
    options: RequestBodyParserOptions = {},
  ) {
    const jsonOptions = Object.assign(
      {type: 'json', limit: DEFAULT_LIMIT},
      getParserOptions('json', options),
    );
    this.jsonParser = json(jsonOptions);

    const urlencodedOptions = Object.assign(
      {
        type: 'urlencoded',
        extended: true,
        limit: DEFAULT_LIMIT,
      },
      getParserOptions('urlencoded', options),
    );
    this.urlencodedParser = urlencoded(urlencodedOptions);

    const textOptions = Object.assign(
      {type: 'text/*', limit: DEFAULT_LIMIT},
      getParserOptions('text', options),
    );
    this.textParser = text(textOptions);
  }

  /**
   * Parse the request body
   * @param operationSpec
   * @param request
   * @param options
   */
  async loadRequestBodyIfNeeded(
    operationSpec: OperationObject,
    request: Request,
    options: RequestBodyParserOptions = {},
  ): Promise<RequestBody> {
    if (!operationSpec.requestBody) return Promise.resolve({value: undefined});

    debug('Request body parser options: %j', options);

    const body =
      (await this.parseJsonBody(request)) ||
      (await this.parseUrlencodedBody(request)) ||
      (await this.parseTextBody(request));
    if (body) return body;

    throw new HttpErrors.UnsupportedMediaType(
      `Content-type ${request.get('content-type')} is not supported.`,
    );
  }

  async parseJsonBody(request: Request) {
    if (typeis(request, 'json')) {
      await parse(this.jsonParser, request);
      return {value: request.body};
    }
    return undefined;
  }

  async parseUrlencodedBody(request: Request) {
    if (typeis(request, 'urlencoded')) {
      await parse(this.urlencodedParser, request);
      return {value: request.body, coercionRequired: true};
    }
    return undefined;
  }

  async parseTextBody(request: Request) {
    if (typeis(request, 'text/*')) {
      await parse(this.textParser, request);
      return {value: request.body};
    }
    return undefined;
  }
}
