import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const DISCOVER_SORT_FIELDS = [
  'startDate',
  'startTime',
  'createdAt',
  'title',
] as const;

export type DiscoverSortBy = (typeof DISCOVER_SORT_FIELDS)[number];

export const DISCOVER_SORT_ORDERS = ['asc', 'desc'] as const;

export type DiscoverSortOrder = (typeof DISCOVER_SORT_ORDERS)[number];

export class DiscoverEventsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(DISCOVER_SORT_FIELDS)
  sortBy?: DiscoverSortBy;

  @IsOptional()
  @IsEnum(DISCOVER_SORT_ORDERS)
  sortOrder?: DiscoverSortOrder;
}