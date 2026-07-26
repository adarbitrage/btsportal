import fitz
doc = fitz.open("attached_assets/Image_Selection_for_Direct-Response_Affiliate_Campaigns_1785095115502.pdf")
print("pages:", doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    pix.save(f".agents/outputs/image-foundations/report-p{i+1:02d}.png")
    imgs = page.get_images(full=True)
    if imgs: print(f"page {i+1}: {len(imgs)} embedded images")
