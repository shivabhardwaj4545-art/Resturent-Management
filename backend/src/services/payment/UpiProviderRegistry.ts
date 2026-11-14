import { IUpiPaymentProvider } from './types';
import { MockUpiProvider } from './providers/MockUpiProvider';
import { BankUpiProvider } from './providers/BankUpiProvider';
import { logger } from '../../utils/logger';

export class UpiProviderRegistry {
  private static providers: Map<string, IUpiPaymentProvider> = new Map();
  private static defaultProviderName: string = 'mock';

  static {
    // Register built-in providers
    this.registerProvider('mock', new MockUpiProvider());
    this.registerProvider('bank', new BankUpiProvider());
    this.registerProvider('hdfc', new BankUpiProvider({ mcc: '5812' }));
    this.registerProvider('icici', new BankUpiProvider({ mcc: '5812' }));
    this.registerProvider('cashfree', new BankUpiProvider({ mcc: '5812' }));
  }

  public static registerProvider(name: string, provider: IUpiPaymentProvider): void {
    this.providers.set(name.toLowerCase(), provider);
    logger.info(`[UpiProviderRegistry] Registered UPI provider: ${name}`);
  }

  public static getProvider(name?: string): IUpiPaymentProvider {
    const providerKey = (name || process.env.UPI_PROVIDER || this.defaultProviderName).toLowerCase();
    const provider = this.providers.get(providerKey);

    if (!provider) {
      logger.warn(`[UpiProviderRegistry] Provider '${providerKey}' not found. Falling back to 'mock'.`);
      return this.providers.get('mock')!;
    }

    return provider;
  }
}
