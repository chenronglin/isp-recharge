import { t } from 'elysia';

export const CreateCategoryBodySchema = t.Object({
  categoryName: t.String({ minLength: 1 }),
  parentId: t.Optional(t.String()),
  sortNo: t.Optional(t.Number()),
});

export const CreateProductBodySchema = t.Object({
  categoryId: t.String(),
  productName: t.String({ minLength: 1 }),
  productType: t.String({ minLength: 1 }),
  deliveryType: t.String({ minLength: 1 }),
  targetType: t.String({ minLength: 1 }),
});

export const CreateSkuBodySchema = t.Object({
  productId: t.String(),
  skuName: t.String({ minLength: 1 }),
  faceValue: t.Number({ minimum: 0 }),
  operator: t.Optional(t.String()),
  region: t.Optional(t.String()),
  baseCostPrice: t.Number({ minimum: 0 }),
  baseSalePrice: t.Number({ minimum: 0 }),
});

export const CreateMappingBodySchema = t.Object({
  skuId: t.String(),
  supplierId: t.String(),
  supplierSkuCode: t.String({ minLength: 1 }),
  priority: t.Optional(t.Number({ minimum: 1 })),
  weight: t.Optional(t.Number({ minimum: 1 })),
  routeType: t.Optional(t.String()),
  costPrice: t.Number({ minimum: 0 }),
});
