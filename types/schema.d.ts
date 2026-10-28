/**
 * lib/schema.js 与 pipeline/schemas/* 的类型（T3.5 · S3.2）。
 *
 * 这里的类型与 schema 对象是**同一份知识的两面**：
 * - 运行时：`pipeline/schemas/*.js` 里的 spec 对象被 validateRow 解释；
 * - 编译期：本文件让 tsc 知道校验后的行长什么样。
 *
 * 改 schema 时两边都要动 —— 只改运行时，让类型慢慢漂移，是比不写类型更糟的状态。
 */

/** 字段类型。`enum` 是独立类型，靠 values 判定。 */
export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'enum' | 'any';

/** 单个字段的规则。 */
export interface FieldRule {
  type?: FieldType;
  /** 必填：缺失 / null / 空串三者都算缺失。 */
  required?: boolean;
  /** `type: 'enum'` 时必填。 */
  values?: readonly (string | number)[];
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: RegExp;
}

/** 一行数据的 schema：字段名 → 规则。 */
export type RowSchema = Record<string, FieldRule>;

/** 跨字段语义规则（schema 表达不了的一致性）。 */
export interface RowRule<T = Record<string, unknown>> {
  id: string;
  /** 返回 null 表示通过，返回字符串表示原因。 */
  check: (row: T) => string | null;
}

/** 一层的校验规格。 */
export interface LayerSpec<T = Record<string, unknown>> {
  schema: RowSchema | null;
  rules: RowRule<T>[];
  /** 隔离比例阈值（默认 0.02）。 */
  threshold: number;
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

export interface PartitionResult<T> {
  good: T[];
  bad: Array<{ row: T; errors: string[] }>;
}

export interface QuarantineRatio {
  ratio: number;
  over: boolean;
  threshold: number;
}

export type QuarantineResult<T = Record<string, unknown>> = {
  rows: T[];
  quarantined: Array<{ row: T; reasons: string[] }>;
  total: number;
  kept: number;
  ratio: number;
  overThreshold: boolean;
  threshold: number;
};

export interface QuarantineSummary {
  total: number;
  kept: number;
  quarantined: number;
  ratio: number;
  threshold: number;
  over_threshold: boolean;
  samples: Array<{ id: string; reasons: string[] }>;
}

export function validateRow(spec: RowSchema, row: unknown): ValidateResult;
export function partitionRows<T>(spec: RowSchema, rows: T[]): PartitionResult<T>;
export function quarantineRatio(
  total: number,
  quarantined: number,
  threshold?: number,
): QuarantineRatio;
export function quarantineLayer<T>(rows: T[], spec: LayerSpec<T>): QuarantineResult<T>;
export function summarizeQuarantine<T>(result: QuarantineResult<T>): QuarantineSummary;

export const HTTP_URL: RegExp;
export const ISO_DATE: RegExp;
export const ISO_DATETIME: RegExp;
export const NON_NEGATIVE: FieldRule;
