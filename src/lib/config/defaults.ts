import type { PublicAppConfig } from "./types";

/** Fallback when the database has no row yet. Visible brand strings read from here or `app_config`. */
export const DEFAULT_CONFIG: PublicAppConfig = {
  brand: {
    appName: "Order King",
    shortName: "Order King",
    companyName: "Order King Foods",
    tagline: "Order like a King.",
    description: "A local food marketplace for Sribhumi. Sample catalogue until real kitchens are verified.",
    logoUrl: "", logoLightUrl: "", logoDarkUrl: "", faviconUrl: "/favicon.svg", appIconUrl: "/icon-192.png", splashIconUrl: "/icon-512.png",
    primaryColor: "#1E4A3A", secondaryColor: "#F4F1EA", accentColor: "#1E4A3A", backgroundColor: "#F4F1EA", surfaceColor: "#FFFCF7", textColor: "#171614", mutedColor: "#6B6560",
    displayFont: "Fraunces", bodyFont: "Figtree", radiusPx: 16, density: "comfortable", themeMode: "light",
    seoTitle: "Order King — food delivery in Sribhumi", seoDescription: "Order from local kitchens in Karimganj / Sribhumi. Clear prices, no mystery fees.", ogImageUrl: "/og.jpg", promotionalHeadline: "From the kitchen to your lane.",
  },
  domain: { primaryDomain: "", webUrl: "/", supportUrl: "/support", privacyUrl: "/legal/privacy", termsUrl: "/legal/terms", refundsUrl: "/legal/refunds", restaurantPortalUrl: "/restaurant", riderPortalUrl: "/rider", adminUrl: "/admin" },
  store: { appStoreName: "Order King", playStoreName: "Order King", shortDescription: "Order food in Sribhumi", longDescription: "Order King is a local food marketplace for Karimganj / Sribhumi, Assam. Browse kitchens, customise items, and pay on delivery.", publisherName: "Order King Foods", supportUrl: "/support", privacyUrl: "/legal/privacy" },
  communication: { notificationSenderName: "Order King", smsSenderId: "", whatsappDisplayName: "Order King", whatsappNumber: "", emailSenderName: "Order King", emailFromAddress: "", supportName: "Order King Support", supportEmail: "support@orderking.in", supportPhone: "", grievanceOfficerName: "Grievance Officer", grievanceEmail: "grievance@orderking.in" },
  invoice: { companyName: "Order King Foods", logoUrl: "", address: "Sribhumi, Assam, India", gstin: "PENDING", fssai: "PENDING", supportContact: "support@orderking.in", footer: "Thank you for ordering.", legalFooter: "This is not a tax invoice until GSTIN is registered." },
  restaurantFacing: { portalName: "Order King for Kitchens", dashboardLogoUrl: "", notificationSender: "Order King Kitchens", settlementStatementBrand: "Order King" },
  business: { legalEntityName: "Order King Foods", country: "IN", defaultCityId: "city_sribhumi", defaultLanguage: "en", supportedLanguages: ["en", "bn", "as", "hi"], timezone: "Asia/Kolkata", currency: "INR", currencyMinorName: "paise" },
  marketplace: { defaultCommissionBps: 1000, allowedCommissionBps: [0, 500, 800, 1000, 1200], serviceFeePaise: 0, serviceFeeBps: 0, packagingDefaultPaise: 0, minOrderPaise: 8000, deliveryBasePaise: 2500, deliveryPerKmPaise: 800, deliveryFreeOverPaise: 39900, riderSpeedKmh: 18, orderPrefix: "O", allowDevTools: true, sampleCatalogueBanner: true, launchMode: "development" },
  tax: { menuPricesIncludeTax: true, menuTaxBps: 500, deliveryTaxBps: 0, serviceTaxBps: 1800, commissionTaxBps: 1800, taxLabel: "GST" },
  notification: { inAppEnabled: true, pushProvider: "none", smsProvider: "none", whatsappProvider: "none", emailProvider: "none" },
};

export function mergeConfig(partial: Partial<PublicAppConfig> | null | undefined): PublicAppConfig {
  if (!partial) return DEFAULT_CONFIG;
  return { brand: { ...DEFAULT_CONFIG.brand, ...partial.brand }, domain: { ...DEFAULT_CONFIG.domain, ...partial.domain }, store: { ...DEFAULT_CONFIG.store, ...partial.store }, communication: { ...DEFAULT_CONFIG.communication, ...partial.communication }, invoice: { ...DEFAULT_CONFIG.invoice, ...partial.invoice }, restaurantFacing: { ...DEFAULT_CONFIG.restaurantFacing, ...partial.restaurantFacing }, business: { ...DEFAULT_CONFIG.business, ...partial.business }, marketplace: { ...DEFAULT_CONFIG.marketplace, ...partial.marketplace }, tax: { ...DEFAULT_CONFIG.tax, ...partial.tax }, notification: { ...DEFAULT_CONFIG.notification, ...partial.notification } };
}
