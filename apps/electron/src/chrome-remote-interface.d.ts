declare module "chrome-remote-interface" {
  interface CDPOptions {
    port?: number;
    host?: string;
    target?: string;
  }

  interface RuntimeDomain {
    enable(): Promise<void>;
    evaluate(params: {
      expression: string;
      returnByValue?: boolean;
      awaitPromise?: boolean;
    }): Promise<{
      result: { value: unknown; type: string };
      exceptionDetails?: { text: string };
    }>;
  }

  interface CDPClient {
    Runtime: RuntimeDomain;
    close(): Promise<void>;
  }

  function CDP(options?: CDPOptions): Promise<CDPClient>;

  namespace CDP {
    function List(options?: { port?: number }): Promise<
      Array<Record<string, string>>
    >;
    type Client = CDPClient;
  }

  export = CDP;
}
