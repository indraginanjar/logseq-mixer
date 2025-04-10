import { BlockEntity } from '@logseq/libs/dist/LSPlugin.user';

export async function openSidePanel() {
  console.log("ran the func");
  let page = await window.logseq.Editor.getPage('LLM in Logseq Plugin');
  if (page !== null){
    //console.log(page.uuid);
    return await window.logseq.Editor.openInRightSidebar(page.uuid);
  }
}

export async function createNewTask(content: string) {
  const rawContent = 'LLM in Logseq Plugin';
  let date = 'LLM in Logseq Plugin';
  let page = await window.logseq.Editor.getPage(date);
  if (page === null) {
    page = await window.logseq.Editor.createPage(date, {
      journal: false,
      redirect: false,
    });
  }
}