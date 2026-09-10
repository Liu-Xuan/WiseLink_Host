import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { DialogueAssessmentService } from './dialogue-assessment.service';
import { DialogueService } from './dialogue.service';

@NeedLogin()
@Controller('api/dialogues')
export class DialogueController {
  constructor(
    private readonly service: DialogueService,
    private readonly assessments: DialogueAssessmentService,
  ) {}
  @Get()
  list(@Req() request: Request, @Query('beforeThreadRef') before?: string) {
    return this.service.list(request, before);
  }
  @Post()
  create(@Body() body: unknown, @Req() request: Request) {
    return this.service.create(body, request);
  }
  @Get(':threadRef')
  read(
    @Param('threadRef') ref: string,
    @Req() request: Request,
    @Query('beforeMessageRef') before?: string,
  ) {
    return this.service.read(ref, request, before);
  }
  @Get(':threadRef/context')
  currentContext(
    @Param('threadRef') ref: string,
    @Query('workItemId') workItemId: string,
    @Req() request: Request,
  ) {
    return this.service.currentContext(ref, workItemId, request);
  }
  @Post(':threadRef/assessment-requests')
  assessment(
    @Param('threadRef') ref: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.assessments.request(ref, body, request);
  }
  @Post(':threadRef/messages')
  append(
    @Param('threadRef') ref: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.service.append(ref, body, request);
  }
  @Post(':threadRef/messages/:messageRef/resume')
  resume(
    @Param('threadRef') ref: string,
    @Param('messageRef') messageRef: string,
    @Req() request: Request,
  ) {
    return this.service.resume(ref, messageRef, request);
  }
  @Post(':threadRef/contributions')
  contribute(
    @Param('threadRef') ref: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.service.contribute(ref, body, request);
  }
  @Post(':threadRef/contributions/:contributionRef/withdraw')
  withdraw(
    @Param('threadRef') ref: string,
    @Param('contributionRef') contributionRef: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.service.withdraw(ref, contributionRef, body, request);
  }
}
