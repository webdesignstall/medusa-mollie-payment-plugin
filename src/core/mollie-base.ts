import { AbstractPaymentProcessor, PaymentProcessorContext, PaymentProcessorError, PaymentProcessorSessionResponse, PaymentSessionStatus, isPaymentProcessorError } from "@medusajs/medusa";
import { MollieApiError, MollieClient, MollieOptions, createMollieClient } from "@mollie/api-client";
import { EOL } from "node:os";
import { MedusaError } from "@medusajs/utils"


export interface PaymentIntentOptions {
    capture_method?: "automatic" | "manual"
    setup_future_usage?: "on_session" | "off_session"
    payment_method_types?: string[]
  }

abstract class MollieBase extends AbstractPaymentProcessor {

    static identifier = ""

  protected readonly options_: MollieOptions
  protected mollie_: MollieClient

  protected constructor(_, options) {
    super(_, options)

    this.options_ = options

    this.init()
  }

  protected init(): void {
    this.mollie_ =
      this.mollie_ || createMollieClient({ apiKey: process.env.MOLLIE_CLIENT_KEY });
  }


  abstract get paymentIntentOptions(): PaymentIntentOptions

  getStripe() {
    return this.mollie_
  }

  getPaymentIntentOptions(): PaymentIntentOptions {
    const options: PaymentIntentOptions = {}

    if (this?.paymentIntentOptions?.capture_method) {
      options.capture_method = this.paymentIntentOptions.capture_method
    }

    if (this?.paymentIntentOptions?.setup_future_usage) {
      options.setup_future_usage = this.paymentIntentOptions.setup_future_usage
    }

    if (this?.paymentIntentOptions?.payment_method_types) {
      options.payment_method_types =
        this.paymentIntentOptions.payment_method_types
    }

    return options
  }


  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const paymentId = paymentSessionData.id as string

    const paymentIntent = await this.mollie_.payments.get(paymentId) as unknown as PaymentSessionStatus

    console.log('getPaymentStatus', paymentIntent);
    
    return PaymentSessionStatus.AUTHORIZED

    // switch (paymentIntent.status) {
    //   case "requires_payment_method":
    //   case "requires_confirmation":
    //   case "processing":
    //     return PaymentSessionStatus.PENDING
    //   case "requires_action":
    //     return PaymentSessionStatus.REQUIRES_MORE
    //   case "canceled":
    //     return PaymentSessionStatus.CANCELED
    //   case "requires_capture":
    //   case "succeeded":
    //     return PaymentSessionStatus.AUTHORIZED
    //   default:
    //     return PaymentSessionStatus.PENDING
    // }

  }


  async initiatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse> {
    try {
      const intentRequestData = this.getPaymentIntentOptions();
      const {
        email,
        context: cart_context,
        currency_code,
        amount,
        resource_id,
        customer,
      } = context;

      const formattedAmount = (amount / 100).toFixed(2);
  
      const payment = await this.mollie_.payments.create({
        amount: {
          value: String(formattedAmount),
          currency: currency_code.toUpperCase(),
        },      
        description: '...',
        redirectUrl: `${process.env.MOLLIE_REDIRECT_URL}`,
        webhookUrl: 'https://yourwebshop.example.org/webhook',
        billingEmail: email,
        metadata: {customerId: customer.id, has_account: customer.has_account}        
      });

      await this.mollie_.payments.update(payment.id, {redirectUrl: `${process.env.MOLLIE_REDIRECT_URL}/checkout?paymentId=${payment?.id}`})
  
      const initiatePayment: Record<string, unknown> = payment as any;
    
      return {
        session_data: initiatePayment,
      };
    } catch (error) {
      // Handle errors and return as PaymentProcessorError
      return this.buildError(
        "An error occurred in initiatePayment",
        error
      );
    }
  }


  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<
    PaymentProcessorError |
    {
      status: PaymentSessionStatus;
      data: PaymentProcessorSessionResponse["session_data"];
    }
  > {
    try {
      
      const status = await this.getPaymentStatus(paymentSessionData);
      
      return {
        status: status,
        data: paymentSessionData
      }
    } catch (e) {
      return {
        error: e.message
      }
    }
  }

 

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const id = paymentSessionData.id as string
    try {
      const intent = await this.mollie_.payments.get(id)
      return intent as unknown as PaymentProcessorSessionResponse["session_data"]
    } catch (error) {
      // if (error.code === ErrorCodes.PAYMENT_INTENT_UNEXPECTED_STATE) {
      //   if (error.payment_intent?.status === ErrorIntentStatus.SUCCEEDED) {
      //     return error.payment_intent
      //   }
      // }

      return this.buildError("An error occurred in capturePayment", error)
    }
  }
  

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const id = paymentSessionData.id as string
      console.log('cancelPayment', paymentSessionData);
    //   return (await this.mollie_.payments.cancel(
    //     id
    //   )) as unknown as PaymentProcessorSessionResponse["session_data"]

    return {};

    } catch (error) {
      if (error.payment_intent?.status === 'canceled') {
        return error
      }

      return this.buildError("An error occurred in cancelPayment", error)
    }
  }

  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    return await this.cancelPayment(paymentSessionData)
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const id = paymentSessionData.id as string
      const intent = await this.mollie_.payments.get(id)
      return intent as unknown as PaymentProcessorSessionResponse["session_data"]
    } catch (e) {
      return this.buildError("An error occurred in retrievePayment", e)
    }
  }


  async updatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse | void> {
    const { amount, customer, paymentSessionData } = context

    const stripeId = customer?.metadata?.stripe_id

    if (stripeId !== paymentSessionData.customer) {
      const result = await this.initiatePayment(context)
      if (isPaymentProcessorError(result)) {
        return this.buildError(
          "An error occurred in updatePayment during the initiate of the new payment for the new customer",
          result
        )
      }

      return result
      
    } else {

      if (amount && paymentSessionData.amount === Math.round(amount)) {
        return
      }

      try {
        const id = paymentSessionData.id as string
        const sessionData = (await this.mollie_.payments.get(id)) as unknown as PaymentProcessorSessionResponse["session_data"]

        return { session_data: paymentSessionData }
      } catch (e) {
        return this.buildError("An error occurred in updatePayment", e)
      }
    }
  }


  async updatePaymentData(sessionId: string, data: Record<string, unknown>) {
    try {
      // Prevent from updating the amount from here as it should go through
      // the updatePayment method to perform the correct logic
      if (data.amount) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Cannot update amount, use updatePayment instead"
        )
      }

      return (await this.mollie_.payments.update(sessionId, {
        ...data,
      })) as unknown as PaymentProcessorSessionResponse["session_data"]
    } catch (e) {
      return this.buildError("An error occurred in updatePaymentData", e)
    }
  }


  protected buildError(
    message: string,
    e: MollieApiError | PaymentProcessorError | Error
  ): PaymentProcessorError {
    return {
      error: message,
      code: "code" in e ? e.code : "",
      detail: isPaymentProcessorError(e)
        ? `${e.error}${EOL}${e.detail ?? ""}`
        : "detail" in e
        ? e.detail
        : e.message ?? "",
    }
  }

}





export default MollieBase;