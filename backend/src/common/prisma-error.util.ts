import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

export function throwPrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        throw new ConflictException(
          'A record with the same unique values already exists',
        );
      case 'P2025':
        throw new NotFoundException('Record not found');
      case 'P2003':
        throw new BadRequestException(
          'Invalid relationship: referenced record does not exist',
        );
    }
  }
  throw error;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}