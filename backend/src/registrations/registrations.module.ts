import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { UserRegistrationsController } from './user-registrations.controller';
import { RegistrationsService } from './registrations.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RegistrationsController, UserRegistrationsController],
  providers: [RegistrationsService],
})
export class RegistrationsModule {}