import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TdmsReceiverIdentityProfile } from './tdms-receiver-identity-profile';

/** Shared deployment identity restriction; it grants no Source access. */
@Module({
  imports: [IdentityModule],
  providers: [TdmsReceiverIdentityProfile],
  exports: [TdmsReceiverIdentityProfile],
})
export class TdmsReceiverIdentityModule {}
