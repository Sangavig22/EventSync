import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';

type LockedTicketType = {
  id: string;
  eventId: string;
  price: string;
  quantity: number;
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrder(userId: string, createOrderDto: CreateOrderDto) {
    this.assertNoDuplicateTicketTypes(
      createOrderDto.items.map((item) => item.ticketTypeId),
    );

    return this.prisma.$transaction(async (tx) => {
      const ticketTypeIds = [
        ...new Set(createOrderDto.items.map((item) => item.ticketTypeId)),
      ].sort();

      const locked = await tx.$queryRaw<LockedTicketType[]>`
        SELECT "id", "eventId", "price", "quantity"
        FROM "TicketType"
        WHERE "id" IN (${Prisma.join(ticketTypeIds)})
        ORDER BY "id"
        FOR UPDATE
      `;

      const lockedById = new Map(
        locked.map((ticketType) => [ticketType.id, ticketType]),
      );

      let eventId: string | null = null;
      const orderItems: {
        ticketTypeId: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
      }[] = [];
      let totalAmount = new Prisma.Decimal(0);

      for (const item of createOrderDto.items) {
        const ticketType = lockedById.get(item.ticketTypeId);
        if (!ticketType) {
          throw new NotFoundException(
            `Ticket type with id ${item.ticketTypeId} not found`,
          );
        }

        if (eventId === null) {
          eventId = ticketType.eventId;
        } else if (ticketType.eventId !== eventId) {
          throw new BadRequestException(
            'All ticket types in an order must belong to the same event',
          );
        }

        const aggregate = await tx.orderItem.aggregate({
          where: {
            ticketTypeId: item.ticketTypeId,
            order: { status: { in: [OrderStatus.PENDING, OrderStatus.PAID] } },
          },
          _sum: { quantity: true },
        });
        const reserved = aggregate._sum.quantity ?? 0;

        if (item.quantity > ticketType.quantity - reserved) {
          throw new BadRequestException(
            `Insufficient inventory for ticket type ${item.ticketTypeId}: requested ${item.quantity}, available ${
              ticketType.quantity - reserved
            }`,
          );
        }

        const unitPrice = new Prisma.Decimal(ticketType.price);
        orderItems.push({
          ticketTypeId: item.ticketTypeId,
          quantity: item.quantity,
          unitPrice,
        });
        totalAmount = totalAmount.add(unitPrice.mul(item.quantity));
      }

      return tx.order.create({
        data: {
          userId,
          status: OrderStatus.PENDING,
          totalAmount,
          items: { create: orderItems },
        },
        include: { items: true },
      });
    });
  }

  async findMine(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            ticketType: {
              select: { id: true, name: true, eventId: true },
            },
          },
        },
      },
    });
  }

  private assertNoDuplicateTicketTypes(ids: string[]): void {
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Duplicate ticket types in an order are not allowed',
      );
    }
  }
}