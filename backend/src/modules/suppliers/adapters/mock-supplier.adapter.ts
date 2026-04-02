import { generateBusinessNo } from '@/lib/id';
import type { MockSupplierMode, SupplierAdapter } from '@/modules/suppliers/adapters/types';

export class MockSupplierAdapter implements SupplierAdapter {
  readonly code = 'mock-supplier';

  constructor(private readonly mode: MockSupplierMode = 'mock-auto-success') {}

  async submitOrder(_input: {
    orderNo: string;
    productId: string;
    supplierProductCode: string;
  }) {
    return {
      supplierOrderNo: generateBusinessNo('suporder'),
      status: 'ACCEPTED' as const,
    };
  }

  async queryOrder(_input: { supplierOrderNo: string; attemptIndex: number }) {
    if (this.mode === 'mock-auto-fail') {
      return {
        status: 'FAIL' as const,
        reason: '模拟供应商履约失败',
      };
    }

    return {
      status: 'SUCCESS' as const,
    };
  }

  async parseCallback(input: { body: Record<string, unknown> }) {
    return {
      supplierOrderNo: String(input.body.supplierOrderNo ?? ''),
      status: input.body.status === 'FAIL' ? ('FAIL' as const) : ('SUCCESS' as const),
      reason: typeof input.body.reason === 'string' ? input.body.reason : undefined,
    };
  }
}
