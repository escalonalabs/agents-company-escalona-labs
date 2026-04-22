declare module 'nodemailer' {
  interface SendMailOptions {
    from: string;
    to: string;
    subject: string;
    text: string;
  }

  interface SendMailResult {
    messageId: string;
  }

  interface Transporter {
    sendMail(options: SendMailOptions): Promise<SendMailResult>;
  }

  interface NodemailerModule {
    createTransport(connectionUrl: string): Transporter;
  }

  const nodemailer: NodemailerModule;
  export default nodemailer;
}
