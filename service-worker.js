chrome.runtime.onInstalled.addListener(() => { //when installed/updated w/ chrome
    chrome.contextMenus.create({
        id: "analyzeText",
        title: "Analyze with Slopify",
        contexts: ["selection"], // only show when text is highlighted
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "analyzeText") {
        const selectedText = info.selectionText;

        console.log("Selected:", selectedText); //Print selected for debug

        // Send to backend
        const response = await fetch("http://localhost:3000/analyze", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ text: selectedText })
        });

        const data = await response.json();

        console.log("Backend result:", data); 

        // Inject result into page (Currently a Placeholder)
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (result) => {
                alert("Score: " + result.score);
            },
            args: [data]
        });
    }
});
