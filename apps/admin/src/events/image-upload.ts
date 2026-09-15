export async function prepareImage(file:File):Promise<string>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('10MB 이하의 JPG·PNG·WebP 이미지를 선택해주세요.');
 const image=await createImageBitmap(file);
 try{
  const canvas=document.createElement('canvas');
  for(const width of [1600,1200,800]){
   const scale=Math.min(1,width/image.width);canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
   const context=canvas.getContext('2d');if(!context)throw new Error('이미지를 처리하지 못했습니다.');context.drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [0.85,0.7,0.5]){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(blob&&blob.size<=196608){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}}
  }
  throw new Error('이미지를 조금 더 작게 줄여주세요.');
 }finally{image.close();}
}
