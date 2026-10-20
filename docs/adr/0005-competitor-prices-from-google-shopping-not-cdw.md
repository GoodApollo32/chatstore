# Competitor Prices come from Google Shopping, never from CDW's website

Chris prices to CDW.ca (Customer Price = CDW's price, capped at MSRP, never below the Price Floor). CDW's site terms
forbid using robots or any routine to monitor its prices without written permission, BC courts have enforced such
terms (Century 21 Canada v. Rogers, 2011 BCSC 1196), and CDW offers no price feed. So CDW's price is read from its
public Google Shopping listings through a paid search-data service, only for products being shown or quoted (plus a
daily check of best sellers), and the system never requests pages from cdw.ca. Some parts will have no Competitor
Price as a result, and the Markup Rule covers them. Details: `docs/competitor-pricing-research.md`.
