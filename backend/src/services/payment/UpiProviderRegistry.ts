import { IUpiPaymentProvider } from './types';
import { DirectVpaProvider } from './providers/DirectVpaProvider';
import { MockUpiProvider } from './providers/MockUpiProvider';
import { BankUpiProvider } from './providers/BankUpiProvider';
import { logger } from '../../utils/logger';

export class UpiProviderRegistry {
  private static providers: Map<string, IUpiPaymentProvider> = new Map();
  private static defaultProviderName: string = 'direct_upi';

  static {
    const directProvider = new DirectVpaProvider();
    // Register built-in providers
    this.registerProvider('direct_upi', directProvider);
    this.registerProvider('direct_vpa', directProvider);
    this.registerProvider('direct', directProvider);
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
    const requestedName = name || process.env.UPI_PROVIDER;
    const providerKey = (requestedName || this.defaultProviderName).toLowerCase();
    const provider = this.providers.get(providerKey);

    if (!provider) {
      // In production or when unspecified, fallback safely to DirectVpaProvider instead of Mock
      logger.warn(`[UpiProviderRegistry] Provider '${providerKey}' not found. Falling back to '${this.defaultProviderName}'.`);
      return this.providers.get(this.defaultProviderName)!;
    }

    return provider;
  }
}
