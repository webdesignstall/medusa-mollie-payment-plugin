import express, { Router } from "express"

import { createMollieClient } from '@mollie/api-client';

import Medusa from "@medusajs/medusa-js"

import { 
  getConfigFile, 
  parseCorsOrigins,
} from "medusa-core-utils"
import { 
  ConfigModule, 
} from "@medusajs/medusa/dist/types/global"
import cors from "cors"

const mollie = createMollieClient({ apiKey: 'test_6V8uCewaxHPaSK4PSfKNxdJPBh5TMr' });

const app = express();

export default (rootDirectory, options) => {
  const router = Router()

  const { configModule } = 
    getConfigFile<ConfigModule>(rootDirectory, "medusa-config")
  const { projectConfig } = configModule

  const storeCorsOptions = {
    origin: projectConfig.store_cors.split(","),
    credentials: true,
  }

  router.use(express.json())
  router.use(express.urlencoded({ extended: true }))

  
  router.options("/store/hello", cors(storeCorsOptions))
  router.get("/check-payment",cors(storeCorsOptions), async(req, res) => {

    const paymentId = req.query.paymentId as string

    try {
        const {status} = await mollie.payments.get(paymentId);

        res.json({status})
        
      } catch (error) {
        console.error(error);
        res.status(500).json({error});
      }
  })

  return router
}